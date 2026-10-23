import { createHash, randomUUID } from "node:crypto";
import type { BankImportResult } from "../contracts/api.ts";
import type { ActivityEvent, BankCredit } from "../contracts/domain.ts";
import { parseBankCsv, type ParsedBankRow } from "./bank-csv.ts";
import { AppError } from "./errors.ts";
import { normalizeBank, normalizePayer, normalizeReference } from "./normalization.ts";
import type { Context } from "./operations.ts";

export interface BankImportCommand {
  expectedVersion: number;
  file: { bytes: Uint8Array; mimeType: string; filename: string };
}
type CreditFields = Pick<ParsedBankRow, "postedDate" | "amountSen" | "reference" | "payer" | "bank">;
export interface BankImportBatch {
  id: string;
  companyId: string;
  actorId: string;
  requestId: string;
  importedAt: string;
  sourceSha256: string;
  sourceName: string;
  sourceMime: string;
  rows: {
    rowNumber: number;
    externalId: string;
    creditId: string;
    status: "imported" | "skipped_duplicate";
    reason: "imported" | "same_external_id" | "same_fingerprint";
    normalized: CreditFields;
  }[];
}

function normalizedFields(row: CreditFields): CreditFields {
  return { postedDate: row.postedDate, amountSen: row.amountSen, reference: normalizeReference(row.reference),
    payer: normalizePayer(row.payer), bank: normalizeBank(row.bank) };
}

function fingerprint(row: CreditFields): string {
  const value = normalizedFields(row);
  return JSON.stringify([value.bank, value.postedDate, value.amountSen, value.reference, value.payer]);
}

function validateCommand(value: BankImportCommand): void {
  const invalid = (field: string, message: string): never => {
    throw new AppError(422, "VALIDATION_ERROR", message, { fieldErrors: [{ field, code: "invalid", message }] });
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("body", "Expected an import command.");
  if (Object.keys(value).some(key => !["expectedVersion", "file"].includes(key))) invalid("body", "Unexpected command field.");
  if (!Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 1) invalid("expectedVersion", "Expected a positive safe-integer version.");
  const file = value.file;
  if (!file || typeof file !== "object" || Array.isArray(file) ||
      Object.keys(file).some(key => !["bytes", "mimeType", "filename"].includes(key)) || !(file.bytes instanceof Uint8Array) ||
      typeof file.mimeType !== "string" || typeof file.filename !== "string") {
    invalid("file", "Expected a CSV file with bytes, MIME type and filename.");
  }
  const mime = file.mimeType.toLowerCase().split(";", 1)[0].trim();
  if (!["text/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream"].includes(mime)) {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Expected a CSV text file.");
  }
}

/** The caller owns the transaction containing import, provenance, audit and idempotency. */
export function importBankStatement(ctx: Context, command: BankImportCommand): BankImportResult {
  validateCommand(command);
  const company = ctx.store.getCompany(ctx.actor.companyId);
  if (!company) throw new AppError(404, "NOT_FOUND", "Resource not found.");
  if (company.version !== command.expectedVersion) {
    throw new AppError(409, "VERSION_CONFLICT", "The bank ledger changed. Refresh before importing.", {
      currentVersion: company.version, entityType: "company", entityId: company.id,
    });
  }
  const rows = parseBankCsv(command.file.bytes, ctx.now);
  const existing = ctx.store.list<BankCredit>("bankCredits", company.id);
  const byId = new Map(existing.map(credit => [credit.id, credit]));
  const byExternalId = new Map(existing.map(credit => [credit.externalId.trim(), credit]));
  const byFingerprint = new Map(existing.map(credit => [fingerprint(credit), credit]));
  // Skipped alternate IDs remain aliases, preventing a later file from reusing one for a different payment.
  for (const previous of ctx.store.getBankImports(company.id) as BankImportBatch[]) {
    for (const row of previous.rows) {
      const credit = byId.get(row.creditId);
      if (credit) byExternalId.set(row.externalId, credit);
    }
  }
  const inserted: BankCredit[] = [];
  const duplicates: BankImportResult["duplicates"] = [];
  const provenance: BankImportBatch["rows"] = [];
  for (const row of rows) {
    const fields = normalizedFields(row);
    const externalMatch = byExternalId.get(row.externalId);
    if (externalMatch && fingerprint(externalMatch) !== fingerprint(row)) {
      throw new AppError(409, "BANK_IMPORT_CONFLICT", "An external ID already refers to different bank evidence. No records were imported.", {
        rowNumbers: [row.rowNumber], reasonCodes: ["external_id_conflict"],
      });
    }
    const duplicate = externalMatch ?? byFingerprint.get(fingerprint(row));
    if (duplicate) {
      const reason = externalMatch ? "external_id" : "fingerprint";
      duplicates.push({ rowNumber: row.rowNumber, existingCreditId: duplicate.id, reason });
      provenance.push({ rowNumber: row.rowNumber, externalId: row.externalId, creditId: duplicate.id,
        status: "skipped_duplicate", reason: externalMatch ? "same_external_id" : "same_fingerprint", normalized: fields });
      byExternalId.set(row.externalId, duplicate);
      continue;
    }
    const credit: BankCredit = {
      id: `credit_${randomUUID()}`, companyId: company.id, version: 1, createdAt: ctx.now, updatedAt: ctx.now,
      externalId: row.externalId, ...fields, allocatedPaymentId: null,
    };
    inserted.push(credit);
    provenance.push({ rowNumber: row.rowNumber, externalId: row.externalId, creditId: credit.id,
      status: "imported", reason: "imported", normalized: fields });
    byId.set(credit.id, credit);
    byExternalId.set(credit.externalId, credit);
    byFingerprint.set(fingerprint(credit), credit);
  }
  // Plan the whole batch before writing; a conflict cannot leave a partial import even for direct callers.
  if (inserted.length && !Number.isSafeInteger(company.version + 1)) {
    throw new AppError(409, "INVALID_STATE", "Bank ledger version limit reached.");
  }
  for (const credit of inserted) ctx.store.insert("bankCredits", credit);
  const companyVersion = company.version + (inserted.length ? 1 : 0);
  if (inserted.length) ctx.store.updateCompany({ ...company, version: companyVersion });
  const batch: BankImportBatch = {
    id: `bankimport_${randomUUID()}`, companyId: company.id, actorId: ctx.actor.id,
    requestId: ctx.requestId, importedAt: ctx.now, sourceSha256: createHash("sha256").update(command.file.bytes).digest("hex"),
    sourceName: command.file.filename.split(/[\\/]/u).at(-1)!.replace(/[\u0000-\u001F\u007F]/gu, "").slice(0, 255) || "bank.csv",
    sourceMime: command.file.mimeType.toLowerCase().split(";", 1)[0].trim(), rows: provenance,
  };
  ctx.store.recordBankImport(batch);
  const event: ActivityEvent = {
    id: `evt_${randomUUID()}`, companyId: company.id, actorId: ctx.actor.id,
    action: "bank.imported", entityType: "bank_import", entityId: batch.id, occurredAt: ctx.now,
    outcome: "succeeded", reasonCode: null, requestId: ctx.requestId,
    summary: `Bank CSV imported: ${inserted.length} new credits; ${duplicates.length} duplicate records skipped.`,
  };
  ctx.store.insert("activityLog", event);
  return { companyVersion, insertedCount: inserted.length, duplicateCount: duplicates.length, bankCredits: inserted, duplicates };
}
