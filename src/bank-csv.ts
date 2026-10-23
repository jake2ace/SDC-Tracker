import { AppError } from "./errors.ts";
import { normalizeBank, normalizePayer, normalizeReference } from "./normalization.ts";

export interface ParsedBankRow {
  /** Logical CSV record number, including the header, even for multiline fields. */
  rowNumber: number;
  externalId: string;
  postedDate: string;
  amountSen: number;
  reference: string;
  payer: string;
  bank: string;
}

const HEADER = ["externalId", "postedDate", "amountSen", "reference", "payer", "bank"] as const;
const MAX_BYTES = 1_048_576;
const MAX_ROWS = 1_000;
type FieldError = { field: string; code: string; message: string };

function invalid(rowNumber: number, field: string, message: string): never {
  throw new AppError(422, "VALIDATION_ERROR", "The bank CSV is invalid.", {
    fieldErrors: [{ field, code: "invalid", message }], rowNumbers: [rowNumber],
  });
}

/** Parse quoted CSV without splitting embedded commas or line breaks. */
function recordsFrom(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let state: "start" | "plain" | "quoted" | "closed" = "start";
  let active = false;
  const field = () => { record.push(value); value = ""; state = "start"; };
  const recordEnd = () => {
    field();
    records.push(record);
    record = [];
    active = false;
    if (records.length > MAX_ROWS + 1) {
      invalid(records.length, "file", `At most ${MAX_ROWS} data records are allowed.`);
    }
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (state === "quoted") {
      if (char === '"') {
        if (text[index + 1] === '"') { value += '"'; index++; }
        else state = "closed";
      } else value += char;
      continue;
    }
    if (char === ",") { field(); active = true; continue; }
    if (char === "\r" || char === "\n") {
      if (char === "\r") {
        if (text[index + 1] !== "\n") invalid(records.length + 1, "file", "Use CRLF or LF record separators.");
        index++;
      }
      recordEnd();
      continue;
    }
    if (state === "closed") invalid(records.length + 1, "file", "Unexpected text after a closing quote.");
    if (char === '"') {
      if (state !== "start") invalid(records.length + 1, "file", "A quote must begin a field or be escaped inside a quoted field.");
      state = "quoted";
    } else {
      value += char;
      state = "plain";
    }
    active = true;
  }
  if (state === "quoted") invalid(records.length + 1, "file", "A quoted field is not closed.");
  if (active || record.length || value.length) recordEnd();
  return records;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Validate the complete file before the caller writes any bank evidence. */
export function parseBankCsv(bytes: Uint8Array, asOf: string): ParsedBankRow[] {
  if (bytes.byteLength > MAX_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Bank CSV files must not exceed 1 MiB.");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { invalid(1, "file", "The bank CSV must contain valid UTF-8 text."); }
  if (text.startsWith("\uFEFF")) text = text.slice(1);
  const records = recordsFrom(text);
  if (!records.length || records[0].length !== HEADER.length || records[0].some((name, index) => name !== HEADER[index])) {
    invalid(1, "file", `The header must be exactly ${HEADER.join(",")} in that order.`);
  }
  if (records.length === 1) invalid(2, "file", "At least one bank credit is required.");
  const timestamp = Date.parse(asOf);
  if (!Number.isFinite(timestamp)) throw new AppError(500, "INTERNAL_ERROR", "Invalid server clock.");
  const today = new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const errors: FieldError[] = [];
  const badRows = new Set<number>();
  const rows: ParsedBankRow[] = [];
  for (let index = 1; index < records.length; index++) {
    const values = records[index];
    const rowNumber = index + 1;
    const error = (field: string, message: string) => {
      badRows.add(rowNumber);
      errors.push({ field: `rows[${rowNumber}].${field}`, code: "invalid", message });
    };
    if (values.length !== HEADER.length) {
      error("record", "Each data record must have exactly six fields.");
      continue;
    }
    const [rawId, postedDate, rawAmount, rawReference, rawPayer, rawBank] = values;
    const externalId = rawId.trim();
    const reference = normalizeReference(rawReference);
    const payer = normalizePayer(rawPayer);
    const bank = normalizeBank(rawBank);
    const checkText = (raw: string, normalized: string, field: string, max: number) => {
      if (!normalized || raw.length > max || normalized.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(raw)) {
        error(field, `Expected non-empty text of at most ${max} characters without control characters.`);
      }
    };
    checkText(rawId, externalId, "externalId", 128);
    if (/[\r\n\t]/u.test(externalId)) error("externalId", "External IDs cannot contain control characters.");
    checkText(rawReference, reference, "reference", 128);
    checkText(rawPayer, payer, "payer", 200);
    checkText(rawBank, bank, "bank", 100);
    if (!isDate(postedDate)) error("postedDate", "Expected a real YYYY-MM-DD date.");
    else if (postedDate > today) error("postedDate", "Bank posting dates cannot be in the future.");
    const amountSen = Number(rawAmount);
    if (!/^[1-9]\d*$/u.test(rawAmount) || !Number.isSafeInteger(amountSen) || amountSen <= 0) {
      error("amountSen", "Expected a positive canonical integer in sen within the safe-integer range.");
    }
    rows.push({ rowNumber, externalId, postedDate, amountSen, reference, payer, bank });
  }
  if (errors.length) {
    throw new AppError(422, "VALIDATION_ERROR", "The bank CSV contains invalid records. No records were imported.", {
      fieldErrors: errors, rowNumbers: [...badRows],
    });
  }
  return rows;
}
