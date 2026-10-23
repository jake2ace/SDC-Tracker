import { createHash } from "node:crypto";
import type { AiInput, AiReceiptOutput, AiReplyOutput, Language, ProcessingStatus, ReceiptEvidence, ReplyExtraction } from "../contracts/domain.ts";
import { ExtractionProviderError, extractionProviderMetadata, type ExtractionProvider } from "./extraction-provider.ts";
import { normalizeBank, normalizePayer, normalizeReference } from "./normalization.ts";

export interface ExtractionProvenance {
  version: "step5-v1";
  provider: string;
  model: string;
  responseModel?: string;
  responseId?: string;
  inputSha256: string;
  redactedInputSha256: string | null;
  outputSha256: string | null;
  modelCalled: boolean;
  validated: boolean;
}
export interface ReplyExtractionResult {
  extraction: ReplyExtraction | null;
  processingStatus: ProcessingStatus;
  fallbackReason: string | null;
  provenance: ExtractionProvenance;
}
export interface ReceiptExtractionResult {
  evidence: ReceiptEvidence | null;
  processingStatus: ProcessingStatus;
  fallbackReason: string | null;
  provenance: ExtractionProvenance;
}
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const ownKeys = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === "object"
  && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const money = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isSafeInteger(value) && value > 0);
const confidence = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
export function validExtractionDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validExtractionTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value.replace(/(?:\.(\d{1,3}))?Z$/, (_, ms: string | undefined) => `.${(ms ?? "").padEnd(3, "0")}Z`);
}
const mytDate = (timestamp: string) => new Date(Date.parse(timestamp) + 8 * 3_600_000).toISOString().slice(0, 10);
const unique = <T>(values: T[]): T[] => [...new Set(values)];
const amountPattern = /\b(?:RM|MYR)\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\d|[.,]\d)/gi;
function amounts(text: string): number[] {
  return unique([...text.matchAll(amountPattern)].filter(match => !/[-(]\s*$/.test(text.slice(0, match.index))).map(match => Number(match[1].replaceAll(",", "")) * 100 + Number((match[2] ?? "").padEnd(2, "0")))
    .filter(value => Number.isSafeInteger(value) && value > 0));
}
const months = ["january|januari", "february|februari", "march|mac", "april", "may|mei", "june|jun", "july|julai", "august|ogos", "september", "october|oktober", "november", "december|disember"];
function explicitDates(text: string): string[] {
  const dates = [...text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)].map(match => `${match[1]}-${match[2]}-${match[3]}`);
  for (const match of text.matchAll(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/g)) dates.push(`${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`);
  months.forEach((month, index) => {
    const re = new RegExp(`\\b(\\d{1,2})\\s+(?:${month})\\s+(\\d{4})\\b`, "gi");
    for (const match of text.matchAll(re)) dates.push(`${match[2]}-${String(index + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`);
  });
  return unique(dates.filter(validExtractionDate));
}
const relativeTomorrow = /\b(tomorrow|esok)\b|明天/i;
const relativeToday = /\b(today|hari ini)\b|今天/i;
const ambiguousDate = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|isnin|selasa|rabu|khamis|jumaat|sabtu|ahad|next week|later|after|selepas|nanti)\b|周[一二三四五六日天]|星期|之后|以后|稍后/i;
const injection = /ignore.{0,50}(?:instruction|previous)|system\s*(?:prompt|message)|\b(?:mark|set|approve).{0,35}(?:invoice|payment|paid)|忽略.{0,20}(?:指令|要求)|直接.{0,20}(?:入账|已付款)/i;

/** A closed lexical projection prevents arbitrary names/addresses from leaving the server. */
const safeWords = new Set((`i we you they me us our your their this that the a an for of in on at to from is are was were be been being have has had do does did done can could will would shall should may might must not no never only some all and or but so as if then than with without it its please thank thanks check need needs just now already still paid pay payment payments paying transfer transferred completed sent send receipt invoice bank entry reference remaining remainder rest balance part partial half full amount total work milestone finished finish twice same correct agreed review dispute disputing unclear maybe tomorrow today monday tuesday wednesday thursday friday saturday sunday later after before next week date day resend pdf ignore previous instructions mark received message wrong group what refers less more yet confirm confirmation promised promise committed cannot cant havent didnt
saya kami anda mereka ini itu yang untuk dengan pada dalam ke dari sudah telah belum akan boleh dapat perlu mesti tidak tak bukan hanya semua sebahagian separuh baki jumlah tepat bayar dibayar bayaran pembayaran pindahkan pindah pemindahan dibuat resit hantar invois sila semak rekod selepas pelanggan dahulu tetapi siap kerja mempertikaikan sama harga dipersetujui terima kasih semula salinan orang menguruskan hubungi bahagian kewangan pasti mungkin nanti mesej kurang jelas esok hari isnin selasa rabu khamis jumaat sabtu ahad
january januari february februari march mac april may mei june jun july julai august ogos september october oktober november december disember`).split(/\s+/));
const chinesePhrases = ["这张发票", "已经转账", "已经付款", "刚刚转了", "参考号", "银行记录", "付款截图", "款项", "付好了", "稍后", "发给你", "核对", "我们", "承诺", "支付", "明天", "今天", "先付了", "已转", "不是全额", "余款", "还需要安排", "剩下的", "还没付", "付了一部分", "这个阶段", "还没有完成", "不同意", "现在付款", "重复开票", "请先核对", "两张发票", "发票金额不对", "修改后", "再讨论付款", "收到", "先问一下同事", "周五", "这个消息", "可能", "发错群", "不确定", "谢谢", "付款", "付", "我", "你", "了", "请", "的", "是", "在", "后", "还", "等"];
const chinesePattern = new RegExp(chinesePhrases.sort((a, b) => b.length - a.length).join("|"), "g");
function projectReply(text: string): string {
  // Protect only validated financial/date literals. All other numbers and text are removed.
  const protectedValues: string[] = [];
  const protect = (literal: string) => { const index = protectedValues.push(literal) - 1; return `\u0001${index}\u0002`; };
  let value = text.normalize("NFKC").replace(amountPattern, match => protect(match));
  value = value.replace(/\b\d{4}-\d{2}-\d{2}\b|\d{4}年\s*\d{1,2}月\s*\d{1,2}日/g, match => protect(match));
  months.forEach(month => { value = value.replace(new RegExp(`\\b\\d{1,2}\\s+(?:${month})\\s+\\d{4}\\b`, "gi"), match => protect(match)); });
  const tokens = value.match(/\u0001\d+\u0002|[A-Za-z]+|[\p{Script=Han}]+|[.,!?;:，。！？；：…]|\s+|[^\s]/gu) ?? [];
  return tokens.map(token => {
    if (token.startsWith("\u0001")) return protectedValues[Number(token.slice(1, -1))];
    if (/^[A-Za-z]+$/.test(token)) return safeWords.has(token.toLowerCase()) ? token.toLowerCase() : "[REDACTED]";
    if (/\p{Script=Han}/u.test(token)) return (token.match(chinesePattern) ?? []).join("") || "[REDACTED]";
    return /^[\s.,!?;:，。！？；：…]+$/.test(token) ? token : "[REDACTED]";
  }).join("").replace(/(?:\[REDACTED\]\s*)+/g, "[REDACTED] ").trim();
}

function provenance(text: string, provider: ExtractionProvider): ExtractionProvenance {
  return { version: "step5-v1", ...extractionProviderMetadata(provider), inputSha256: sha(text), redactedInputSha256: null, outputSha256: null, modelCalled: false, validated: false };
}
function validateReply(output: unknown): output is AiReplyOutput {
  return ownKeys(output, ["intent", "promisedDate", "amountSen", "confidence"])
    && ["paid", "promise", "partial", "dispute", "other"].includes(String(output.intent))
    && (output.promisedDate === null || validExtractionDate(output.promisedDate))
    && money(output.amountSen) && confidence(output.confidence);
}
function validateReceipt(output: unknown): output is AiReceiptOutput {
  return ownKeys(output, ["bank", "amountSen", "referenceToken", "transferredAt", "payerToken", "confidence"])
    && (output.bank === null || (typeof output.bank === "string" && output.bank.length > 0 && output.bank.length <= 100))
    && money(output.amountSen) && (output.transferredAt === null || validExtractionTimestamp(output.transferredAt))
    && (output.referenceToken === null || typeof output.referenceToken === "string" && /^REF_[A-Z0-9_]+$/.test(output.referenceToken))
    && (output.payerToken === null || typeof output.payerToken === "string" && /^PAYER_[A-Z0-9_]+$/.test(output.payerToken))
    && confidence(output.confidence);
}

export async function extractReply(text: string, receivedAt: string, language: Language, provider: ExtractionProvider): Promise<ReplyExtractionResult> {
  const trace = provenance(text, provider);
  const fail = (reason: string): ReplyExtractionResult => ({ extraction: null, processingStatus: "manual_required", fallbackReason: reason, provenance: trace });
  if (!text.trim() || text.length > 12_000 || !validExtractionTimestamp(receivedAt) || !["en", "ms", "zh"].includes(language)) return fail("INVALID_EXTRACTION_INPUT");
  const normalized = text.normalize("NFKC");
  if (injection.test(normalized)) return fail("UNTRUSTED_INSTRUCTION");
  const redactedText = projectReply(normalized);
  const input: AiInput = { task: "extract_reply", redactedText, language, referenceDate: mytDate(receivedAt), timezone: "Asia/Kuala_Lumpur" };
  trace.redactedInputSha256 = sha(JSON.stringify(input));
  try {
    trace.modelCalled = true;
    const output = await provider(input);
    Object.assign(trace, extractionProviderMetadata(provider, output));
    if (!validateReply(output)) return fail("MODEL_INVALID_OUTPUT");
    trace.outputSha256 = sha(JSON.stringify(output));
    if ((output.intent === "dispute" || output.intent === "other") && (output.amountSen !== null || output.promisedDate !== null)) return fail("UNGROUNDED_MODEL_OUTPUT");
    if (output.amountSen !== null && !amounts(normalized).includes(output.amountSen)) return fail("UNGROUNDED_AMOUNT");
    if (!["promise", "partial"].includes(output.intent) && output.promisedDate !== null) return fail("UNGROUNDED_DATE");
    const dates = explicitDates(normalized);
    let relative = false;
    if (relativeTomorrow.test(normalized)) { dates.push(new Date(Date.parse(mytDate(receivedAt)) + 86_400_000).toISOString().slice(0, 10)); relative = true; }
    if (relativeToday.test(normalized)) { dates.push(mytDate(receivedAt)); relative = true; }
    if (output.promisedDate !== null && (!dates.includes(output.promisedDate) || output.promisedDate < mytDate(receivedAt))) return fail("UNGROUNDED_DATE");
    if (output.intent === "promise" && unique(dates).length > 1) return fail("CONFLICTING_DATES");
    const reason = output.confidence < 0.85 ? "LOW_CONFIDENCE"
      : amounts(normalized).length > 1 ? "CONFLICTING_AMOUNTS"
      : (output.intent === "promise" || output.intent === "partial" && output.promisedDate !== null) && (!output.promisedDate || relative || ambiguousDate.test(normalized)) ? "PROMISE_DATE_REVIEW_REQUIRED"
      : output.intent === "partial" && output.amountSen === null ? "MISSING_PAYMENT_AMOUNT"
      : output.intent === "other" ? "UNCLEAR_REPLY" : null;
    trace.validated = true;
    return { extraction: { ...output, source: "ai", reviewedBy: null, reviewedAt: null }, processingStatus: reason ? "needs_review" : "ready", fallbackReason: reason, provenance: trace };
  } catch (error) { return fail(error instanceof ExtractionProviderError ? error.code : "MODEL_UNAVAILABLE"); }
}

function receiptField(text: string, labels: string): string[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const label = new RegExp(`^(?:${labels})(?:\\s*\\((MYT|UTC)\\))?\\s*(?:[:：]\\s*(.*))?$`, "i");
  const anyLabel = /^(?:bank|from bank|sender bank|payer|sender|from|reference|transaction reference|amount|transfer amount|transferred at|transfer time|transfer date\s*\/\s*time|date\s*\/\s*time)(?:\s*\(.*\))?\s*:?$/i;
  const values: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const match = label.exec(lines[index]);
    if (!match) continue;
    const value = match[2]?.trim() || lines[index + 1];
    if (!value || anyLabel.test(value)) continue;
    // A timezone printed in the label is evidence, never a server default.
    values.push(match[1] && !/(?:Z|MYT|UTC|\+08:00)\s*$/i.test(value) ? `${value} ${match[1]}` : value);
  }
  return unique(values);
}
function transferTimes(text: string): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z\b/g)) if (validExtractionTimestamp(match[0])) values.push(new Date(match[0]).toISOString());
  for (const match of text.matchAll(/\b(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*(MYT|UTC\+0?8(?::?00)?|\+08:00)\b/gi)) {
    const local = `${match[1]}T${match[2]}:${match[3]}:${match[4] ?? "00"}Z`;
    if (validExtractionTimestamp(local)) values.push(new Date(Date.parse(local) - 8 * 3_600_000).toISOString());
  }
  return unique(values);
}
const knownBank = /^(?:DEMO (?:SENDER )?BANK [A-Z]|MAYBANK|CIMB(?: BANK)?|PUBLIC BANK|RHB(?: BANK)?|HONG LEONG BANK|AMBANK|BANK ISLAM|HSBC|OCBC|UOB|AFFIN BANK|ALLIANCE BANK|BANK RAKYAT|BSN|STANDARD CHARTERED)$/;

export async function extractReceipt(ocrText: string, now: string, provider: ExtractionProvider): Promise<ReceiptExtractionResult> {
  const trace = provenance(ocrText, provider);
  const fail = (reason: string): ReceiptExtractionResult => ({ evidence: null, processingStatus: "manual_required", fallbackReason: reason, provenance: trace });
  if (!ocrText.trim()) return fail("OCR_EMPTY");
  if (ocrText.length > 12_000 || !validExtractionTimestamp(now)) return fail("INVALID_EXTRACTION_INPUT");
  const text = ocrText.normalize("NFKC");
  if (injection.test(text)) return fail("UNTRUSTED_INSTRUCTION");
  const refs = receiptField(text, "reference(?: no\\.?| number)?|transaction reference|ref\\.?|参考号").map(normalizeReference);
  const payers = receiptField(text, "payer|sender|from|付款人").map(normalizePayer);
  const banks = receiptField(text, "bank|sender bank|from bank|银行").map(normalizeBank);
  const amountRows = receiptField(text, "amount|transfer amount|金额");
  // Mobile confirmations commonly show a standalone currency amount above the other labels.
  amountRows.push(...text.split(/\r?\n/).map(line => line.trim()).filter(line => /^(?:RM|MYR)\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/i.test(line)));
  const literalAmounts = unique(amountRows.flatMap(amounts));
  const timeRows = receiptField(text, "transferred at|transfer time|transfer date\\s*/\\s*time|date\\s*/\\s*time|date(?: and time)?|time|转账时间");
  const times = unique(timeRows.flatMap(transferTimes));
  if ([refs, payers, banks, literalAmounts, times].some(values => values.length > 1)) return fail("CONFLICTING_RECEIPT_FIELDS");
  if (refs.some(value => value.length > 128) || payers.some(value => value.length > 200) || banks.some(value => value.length > 100)) return fail("INVALID_RECEIPT_FIELD");
  const bank = banks[0] && knownBank.test(banks[0]) ? banks[0] : null;
  const reference = refs[0] ?? null, payer = payers[0] ?? null;
  const redactedText = [
    bank ? `Bank: ${bank}` : "Bank: [REDACTED OR MISSING]",
    literalAmounts[0] ? `Amount: MYR ${Math.floor(literalAmounts[0] / 100)}.${String(literalAmounts[0] % 100).padStart(2, "0")} (amountSen: ${literalAmounts[0]})` : "Amount: missing",
    reference ? "Reference: REF_1" : "Reference: missing",
    payer ? "Payer: PAYER_1" : "Payer: missing",
    times[0] ? `Transferred at: ${times[0]}` : "Transferred at: missing",
  ].join("\n");
  const input: AiInput = { task: "structure_receipt", redactedText, language: "en", referenceDate: mytDate(now), timezone: "Asia/Kuala_Lumpur" };
  trace.redactedInputSha256 = sha(JSON.stringify(input));
  try {
    trace.modelCalled = true;
    const output = await provider(input);
    Object.assign(trace, extractionProviderMetadata(provider, output));
    if (!validateReceipt(output)) return fail("MODEL_INVALID_OUTPUT");
    trace.outputSha256 = sha(JSON.stringify(output));
    if (output.referenceToken !== null && (output.referenceToken !== "REF_1" || !reference)
      || output.payerToken !== null && (output.payerToken !== "PAYER_1" || !payer)) return fail("UNKNOWN_EVIDENCE_TOKEN");
    if (output.bank !== null && normalizeBank(output.bank) !== bank) return fail("UNGROUNDED_BANK");
    if (output.amountSen !== null && !literalAmounts.includes(output.amountSen)) return fail("UNGROUNDED_AMOUNT");
    if (output.transferredAt !== null && !times.includes(new Date(output.transferredAt).toISOString())) return fail("UNGROUNDED_DATE");
    const evidence: ReceiptEvidence = { bank: output.bank === null ? null : bank, amountSen: output.amountSen,
      reference: output.referenceToken ? reference : null, payer: output.payerToken ? payer : null,
      transferredAt: output.transferredAt, confidence: output.confidence, source: "ai", reviewedBy: null, reviewedAt: null };
    const reason = output.confidence < 0.85 ? "LOW_CONFIDENCE"
      : [evidence.bank, evidence.amountSen, evidence.reference, evidence.payer, evidence.transferredAt].some(value => value === null) ? "MISSING_RECEIPT_FIELD"
      : Date.parse(evidence.transferredAt!) > Date.parse(now) ? "FUTURE_TRANSFER_TIME" : null;
    trace.validated = true;
    return { evidence, processingStatus: reason ? "needs_review" : "ready", fallbackReason: reason, provenance: trace };
  } catch (error) { return fail(error instanceof ExtractionProviderError ? error.code : "MODEL_UNAVAILABLE"); }
}
