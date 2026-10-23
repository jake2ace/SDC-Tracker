import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Workspace } from "../contracts/api.ts";
import type { Company, DemoUser, ForecastDefaults } from "../contracts/domain.ts";
import { AppError } from "./errors.ts";
import type { BankImportBatch } from "./bank-import.ts";

const ENTITY_KINDS = [
  "customers", "projects", "milestones", "invoices", "reminders", "replies",
  "receipts", "bankCredits", "matches", "payments", "promises", "expenses", "activityLog",
] as const;

export type EntityKind = typeof ENTITY_KINDS[number];
type StoredKind = EntityKind | "reminderSnapshots";
type Entity = { id: string; companyId: string; version?: number };
type StoredRow = { body: string };
type IdempotencyRecord = { fingerprint: string; status: number; data: unknown };
export interface ReceiptArtifact {
  imageId: string; receiptId: string; companyId: string; bytes: Uint8Array;
  mimeType: string; ocrText: string; ocrEngine: string | null;
  ocrVersion: string | null; ocrError: string | null;
}
export interface ExtractionRun {
  id: string; companyId: string; entityType: "reply" | "receipt"; entityId: string;
  occurredAt: string; actorId: string; source: "ai" | "manual" | "unavailable";
  fallbackReason: string | null; details: unknown;
}
type Seed = {
  companies: Company[];
  users: DemoUser[];
  forecastSettings: (ForecastDefaults & { companyId: string })[];
  matchResults?: Entity[];
  activityLogs?: Entity[];
} & Partial<Record<EntityKind, Entity[]>>;

/** Persistent demo data. Every business-entity read is scoped in SQL to one company. */
export class Store {
  private readonly db: DatabaseSync;
  private readonly seedPath: string;
  private transactionDepth = 0;

  constructor(filename: string, options: { seedPath?: string } = {}) {
    this.seedPath = options.seedPath ?? fileURLToPath(new URL("../data/seed/demo-state.json", import.meta.url));
    if (filename !== ":memory:") mkdirSync(dirname(resolve(filename)), { recursive: true });
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS companies (
          id TEXT PRIMARY KEY,
          body TEXT NOT NULL CHECK (json_valid(body))
            CHECK (json_extract(body, '$.id') IS id)
            CHECK (json_type(body, '$.version') IS 'integer' AND json_extract(body, '$.version') >= 1)
        );
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL REFERENCES companies(id),
          body TEXT NOT NULL CHECK (json_valid(body))
            CHECK (json_extract(body, '$.id') IS id)
            CHECK (json_extract(body, '$.companyId') IS company_id)
            CHECK (json_extract(body, '$.role') IN ('owner', 'finance', 'pm')),
          UNIQUE (id, company_id)
        );
        CREATE TABLE IF NOT EXISTS forecast_defaults (
          company_id TEXT PRIMARY KEY REFERENCES companies(id),
          body TEXT NOT NULL CHECK (json_valid(body))
        );
        CREATE TABLE IF NOT EXISTS entities (
          kind TEXT NOT NULL CHECK (kind IN (
            'customers', 'projects', 'milestones', 'invoices', 'reminders', 'replies',
            'receipts', 'bankCredits', 'matches', 'payments', 'promises', 'expenses', 'activityLog',
            'reminderSnapshots'
          )),
          id TEXT NOT NULL,
          company_id TEXT NOT NULL REFERENCES companies(id),
          body TEXT NOT NULL CHECK (json_valid(body))
            CHECK (json_extract(body, '$.id') IS id)
            CHECK (json_extract(body, '$.companyId') IS company_id)
            CHECK (kind = 'activityLog' OR (
              json_type(body, '$.version') IS 'integer' AND json_extract(body, '$.version') >= 1
            ))
            CHECK (kind != 'invoices' OR (
              json_type(body, '$.milestoneId') IS 'text' AND length(json_extract(body, '$.milestoneId')) > 0
            )),
          PRIMARY KEY (company_id, kind, id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS invoice_per_milestone
          ON entities(company_id, json_extract(body, '$.milestoneId')) WHERE kind = 'invoices';
        CREATE UNIQUE INDEX IF NOT EXISTS payment_per_credit
          ON entities(company_id, json_extract(body, '$.bankCreditId')) WHERE kind = 'payments';
        CREATE UNIQUE INDEX IF NOT EXISTS payment_per_receipt
          ON entities(company_id, json_extract(body, '$.receiptId')) WHERE kind = 'payments';
        CREATE UNIQUE INDEX IF NOT EXISTS payment_per_match
          ON entities(company_id, json_extract(body, '$.matchResultId')) WHERE kind = 'payments';
        CREATE UNIQUE INDEX IF NOT EXISTS active_promise_per_invoice
          ON entities(company_id, json_extract(body, '$.invoiceId'))
          WHERE kind = 'promises' AND json_extract(body, '$.status') = 'active';
        CREATE UNIQUE INDEX IF NOT EXISTS bank_external_id
          ON entities(company_id, json_extract(body, '$.externalId')) WHERE kind = 'bankCredits';
        CREATE UNIQUE INDEX IF NOT EXISTS bank_fingerprint
          ON entities(company_id, json_extract(body, '$.bank'), json_extract(body, '$.postedDate'),
            json_extract(body, '$.amountSen'), json_extract(body, '$.reference'), json_extract(body, '$.payer'))
          WHERE kind = 'bankCredits';
        CREATE TABLE IF NOT EXISTS bank_imports (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL REFERENCES companies(id),
          body TEXT NOT NULL CHECK (json_valid(body))
            CHECK (json_extract(body, '$.id') IS id)
            CHECK (json_extract(body, '$.companyId') IS company_id)
        );
        CREATE TABLE IF NOT EXISTS idempotency (
          company_id TEXT NOT NULL REFERENCES companies(id),
          actor_id TEXT NOT NULL,
          request_key TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          status INTEGER NOT NULL CHECK (status >= 200 AND status <= 599),
          data TEXT NOT NULL CHECK (json_valid(data)),
          PRIMARY KEY (company_id, actor_id, request_key),
          FOREIGN KEY (actor_id, company_id) REFERENCES users(id, company_id)
        );
        CREATE TABLE IF NOT EXISTS receipt_artifacts (
          company_id TEXT NOT NULL REFERENCES companies(id),
          receipt_id TEXT NOT NULL, image_id TEXT NOT NULL,
          bytes BLOB NOT NULL, body TEXT NOT NULL CHECK (json_valid(body)),
          PRIMARY KEY (company_id, receipt_id), UNIQUE (company_id, image_id)
        );
        CREATE TABLE IF NOT EXISTS extraction_runs (
          id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id),
          entity_id TEXT NOT NULL, body TEXT NOT NULL CHECK (json_valid(body))
        );
      `);
      const count = this.db.prepare("SELECT count(*) AS count FROM companies").get() as { count: number };
      if (count.count === 0) this.reset();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  /** Local operator reset, deliberately not an HTTP endpoint. */
  reset(): void {
    const seed = JSON.parse(readFileSync(this.seedPath, "utf8")) as Seed;
    this.transaction(() => {
      this.db.exec(`
        DELETE FROM idempotency;
        DELETE FROM extraction_runs;
        DELETE FROM receipt_artifacts;
        DELETE FROM bank_imports;
        DELETE FROM entities;
        DELETE FROM forecast_defaults;
        DELETE FROM users;
        DELETE FROM companies;
      `);
      const addCompany = this.db.prepare("INSERT INTO companies (id, body) VALUES (?, ?)");
      for (const company of seed.companies) addCompany.run(company.id, JSON.stringify(company));
      const addUser = this.db.prepare("INSERT INTO users (id, company_id, body) VALUES (?, ?, ?)");
      for (const user of seed.users) addUser.run(user.id, user.companyId, JSON.stringify(user));
      const addDefaults = this.db.prepare("INSERT INTO forecast_defaults (company_id, body) VALUES (?, ?)");
      for (const settings of seed.forecastSettings) {
        const { companyId, ...defaults } = settings;
        addDefaults.run(companyId, JSON.stringify(defaults));
      }
      for (const kind of ENTITY_KINDS) {
        const source = kind === "matches" ? seed.matchResults
          : kind === "activityLog" ? seed.activityLogs : seed[kind];
        for (const entity of source ?? []) this.insert(kind, entity);
      }
    });
  }

  getUser(id: string): DemoUser | undefined {
    return this.parse<DemoUser>(this.db.prepare("SELECT body FROM users WHERE id = ?").get(id));
  }

  listUsers(): DemoUser[] {
    return this.db.prepare("SELECT body FROM users ORDER BY rowid").all().map(row => this.parse<DemoUser>(row)!);
  }

  getCompany(id: string): Company | undefined {
    return this.parse<Company>(this.db.prepare("SELECT body FROM companies WHERE id = ?").get(id));
  }

  updateCompany(company: Company): void {
    const result = this.db.prepare("UPDATE companies SET body = ? WHERE id = ?")
      .run(JSON.stringify(company), company.id);
    if (result.changes !== 1) throw new AppError(404, "NOT_FOUND", "Resource not found.");
  }

  recordBankImport(batch: BankImportBatch): void {
    this.db.prepare("INSERT INTO bank_imports (id, company_id, body) VALUES (?, ?, ?)")
      .run(batch.id, batch.companyId, JSON.stringify(batch));
  }

  getBankImports(companyId: string): BankImportBatch[] {
    return this.db.prepare("SELECT body FROM bank_imports WHERE company_id = ? ORDER BY rowid")
      .all(companyId).map((row) => this.parse<BankImportBatch>(row)!);
  }

  insertReceiptArtifact(artifact: ReceiptArtifact): void {
    const { bytes, ...metadata } = artifact;
    this.db.prepare("INSERT INTO receipt_artifacts (company_id, receipt_id, image_id, bytes, body) VALUES (?, ?, ?, ?, ?)")
      .run(artifact.companyId, artifact.receiptId, artifact.imageId, bytes, JSON.stringify(metadata));
  }

  getReceiptArtifact(receiptId: string, companyId: string): ReceiptArtifact | undefined {
    const row = this.db.prepare("SELECT bytes, body FROM receipt_artifacts WHERE company_id = ? AND receipt_id = ?")
      .get(companyId, receiptId) as { bytes: Uint8Array; body: string } | undefined;
    return row ? { ...JSON.parse(row.body), bytes: row.bytes } as ReceiptArtifact : undefined;
  }

  recordExtraction(run: ExtractionRun): void {
    this.db.prepare("INSERT INTO extraction_runs (id, company_id, entity_id, body) VALUES (?, ?, ?, ?)")
      .run(run.id, run.companyId, run.entityId, JSON.stringify(run));
  }

  getExtractionRuns(entityId: string, companyId: string): ExtractionRun[] {
    return this.db.prepare("SELECT body FROM extraction_runs WHERE company_id = ? AND entity_id = ? ORDER BY rowid")
      .all(companyId, entityId).map(row => this.parse<ExtractionRun>(row)!);
  }

  getForecastDefaults(companyId: string): ForecastDefaults {
    const value = this.parse<ForecastDefaults>(this.db.prepare(
      "SELECT body FROM forecast_defaults WHERE company_id = ?",
    ).get(companyId));
    if (!value) throw new AppError(404, "NOT_FOUND", "Resource not found.");
    return value;
  }

  getWorkspace(actor: DemoUser): Workspace {
    // Use persisted membership rather than trusting a caller-supplied company or role.
    const member = this.getUser(actor.id);
    if (!member || member.companyId !== actor.companyId || member.role !== actor.role) {
      throw new AppError(404, "NOT_FOUND", "Resource not found.");
    }
    const company = this.getCompany(member.companyId);
    if (!company) throw new AppError(404, "NOT_FOUND", "Resource not found.");
    const collections = Object.fromEntries(
      ENTITY_KINDS.map(kind => [kind, this.list(kind, company.id)]),
    ) as Pick<Workspace, EntityKind>;
    return { company, actor: member, ...collections, forecastDefaults: this.getForecastDefaults(company.id) };
  }

  get<T>(kind: StoredKind, id: string, companyId: string): T | undefined {
    return this.parse<T>(this.db.prepare(
      "SELECT body FROM entities WHERE company_id = ? AND kind = ? AND id = ?",
    ).get(companyId, kind, id));
  }

  list<T>(kind: StoredKind, companyId: string): T[] {
    return this.db.prepare(
      "SELECT body FROM entities WHERE company_id = ? AND kind = ? ORDER BY rowid",
    ).all(companyId, kind).map(row => this.parse<T>(row)!);
  }

  insert<T extends Entity>(kind: StoredKind, entity: T): void {
    this.db.prepare("INSERT INTO entities (kind, id, company_id, body) VALUES (?, ?, ?, ?)")
      .run(kind, entity.id, entity.companyId, JSON.stringify(entity));
  }

  put<T extends Entity>(kind: StoredKind, entity: T): void {
    const result = this.db.prepare(
      "UPDATE entities SET body = ? WHERE company_id = ? AND kind = ? AND id = ?",
    ).run(JSON.stringify(entity), entity.companyId, kind, entity.id);
    if (result.changes !== 1) throw new AppError(404, "NOT_FOUND", "Resource not found.");
  }

  /** Transactions include domain writes, audit events and idempotency responses together. */
  transaction<T>(fn: () => T): T {
    const level = this.transactionDepth;
    const savepoint = `store_tx_${level}`;
    this.db.exec(level === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
    this.transactionDepth += 1;
    try {
      const result = fn();
      if (result && typeof (result as { then?: unknown }).then === "function") {
        throw new Error("Store transactions require a synchronous callback.");
      }
      this.db.exec(level === 0 ? "COMMIT" : `RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      if (level === 0) this.db.exec("ROLLBACK");
      else this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    } finally {
      this.transactionDepth = level;
    }
  }

  getIdempotency(companyId: string, actorId: string, key: string): IdempotencyRecord | undefined {
    const row = this.db.prepare(`
      SELECT fingerprint, status, data FROM idempotency
      WHERE company_id = ? AND actor_id = ? AND request_key = ?
    `).get(companyId, actorId, key) as { fingerprint: string; status: number; data: string } | undefined;
    if (!row) return undefined;
    return { fingerprint: row.fingerprint, status: row.status, data: JSON.parse(row.data) };
  }

  saveIdempotency(companyId: string, actorId: string, key: string, fingerprint: string, status: number, data: unknown): void {
    this.db.prepare(`
      INSERT INTO idempotency (company_id, actor_id, request_key, fingerprint, status, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(companyId, actorId, key, fingerprint, status, JSON.stringify(data));
  }

  private parse<T>(row: unknown): T | undefined {
    return row === undefined ? undefined : JSON.parse((row as StoredRow).body) as T;
  }
}
