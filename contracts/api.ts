import type {
  ActivityEvent, BankCredit, Company, Customer, DemoUser, Forecast,
  ForecastDefaults, Id, Invoice, Language, MatchResult, Milestone, MytDate,
  Payment, PaymentPromise, Project, Receipt, Reminder, Reply, ReplyIntent,
  Role, Sen, UtcTimestamp, Expense,
} from "./domain";

export const CONTRACT_VERSION = "1.0.0" as const;
export const SERVICE_STATUS = "partial" as const;
export const DEMO_CLOCK = "2026-10-23T04:00:00Z" as const;

export interface ApiMeta {
  requestId: string;
  contractVersion: typeof CONTRACT_VERSION;
  mode: "demo";
  asOf: UtcTimestamp;
  idempotencyReplayed: boolean;
}
export interface ApiSuccess<T> { data: T; meta: ApiMeta; }

export type ErrorCode =
  | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_ERROR"
  | "UNSUPPORTED_MEDIA_TYPE" | "PAYLOAD_TOO_LARGE" | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT" | "IDEMPOTENCY_IN_PROGRESS" | "VERSION_CONFLICT"
  | "INVALID_STATE" | "DUPLICATE_EVIDENCE" | "CREDIT_ALREADY_ALLOCATED"
  | "REVIEW_REQUIRED" | "BANK_IMPORT_CONFLICT" | "INTERNAL_ERROR";
export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    details: {
      fieldErrors?: { field: string; code: string; message: string }[];
      currentVersion?: number;
      entityType?: string;
      entityId?: Id;
      rowNumbers?: number[];
      reasonCodes?: string[];
    };
  };
  meta: ApiMeta;
}

export interface ReadHeaders { "X-Demo-User": Id; }
export interface WriteHeaders extends ReadHeaders { "Idempotency-Key": string; }
export interface VersionedCommand { expectedVersion: number; }

export interface Workspace {
  company: Company;
  actor: DemoUser;
  customers: Customer[];
  projects: Project[];
  milestones: Milestone[];
  invoices: Invoice[];
  reminders: Reminder[];
  replies: Reply[];
  receipts: Receipt[];
  bankCredits: BankCredit[];
  matches: MatchResult[];
  payments: Payment[];
  promises: PaymentPromise[];
  expenses: Expense[];
  activityLog: ActivityEvent[];
  forecastDefaults: ForecastDefaults;
}

export interface InvoiceDecisionCommand extends VersionedCommand {
  decision: "approve" | "reject";
  /** Required and non-empty for rejection; null allowed for approval. */
  reason: string | null;
}
export interface GenerateReminderCommand extends VersionedCommand { language: Language; }
export interface SendReminderCommand extends VersionedCommand {
  expectedInvoiceVersion: number;
  text: string;
}
export interface CreateReplyCommand extends VersionedCommand {
  text: string;
  receivedAt: UtcTimestamp;
  language: Language;
}
export interface CorrectReplyCommand extends VersionedCommand {
  intent: ReplyIntent;
  promisedDate: MytDate | null;
  amountSen: Sen | null;
  reason: string;
}
/** multipart/form-data: file is binary, expectedVersion and replyId are text parts. */
export interface UploadReceiptCommand extends VersionedCommand {
  file: Blob;
  replyId?: Id;
  /** Required exactly when replyId is supplied. */
  expectedReplyVersion?: number;
}
export interface CorrectReceiptCommand extends VersionedCommand {
  bank: string;
  amountSen: Sen;
  reference: string;
  transferredAt: UtcTimestamp;
  payer: string;
  reason: string;
}
/** multipart/form-data: expectedVersion refers to Company.version. */
export interface ImportBankStatementCommand extends VersionedCommand { file: Blob; }
export interface RunMatchCommand extends VersionedCommand {
  expectedInvoiceVersion: number;
}
export interface ConfirmPromiseCommand extends VersionedCommand {
  expectedInvoiceVersion: number;
  promisedDate: MytDate;
  /** Must equal the invoice's entire current outstanding amount. */
  amountSen: Sen;
}

export interface InvoiceDraftResult { invoice: Invoice; milestone: Milestone; existing: boolean; }
export interface ReplyCreatedResult { reply: Reply; fallbackReason: string | null; }
export interface ReceiptUploadedResult {
  receipt: Receipt;
  existing: boolean;
  fallbackReason: string | null;
}
export interface BankImportResult {
  companyVersion: number;
  insertedCount: number;
  duplicateCount: number;
  bankCredits: BankCredit[];
  duplicates: { rowNumber: number; existingCreditId: Id; reason: "external_id" | "fingerprint" }[];
}
export interface PaymentApprovedResult {
  payment: Payment;
  invoice: Invoice;
  bankCredit: BankCredit;
  match: MatchResult;
  companyVersion: number;
}
export interface PromiseConfirmedResult { promise: PaymentPromise; invoice: Invoice; reply: Reply; }
export interface ForecastQuery { asOfDate: MytDate; delayDays: number; }
export interface AuthorizedImage { contentType: Receipt["mimeType"]; body: Blob; }

/** Types indexed by stable operationId; per-endpoint status is listed below. */
export interface ApiOperations {
  listDemoUsers: { request: undefined; response: ApiSuccess<{ users: DemoUser[] }> };
  getWorkspace: { request: undefined; response: ApiSuccess<Workspace> };
  completeMilestone: { request: VersionedCommand; response: ApiSuccess<Milestone> };
  createInvoiceDraft: { request: VersionedCommand; response: ApiSuccess<InvoiceDraftResult> };
  decideInvoice: { request: InvoiceDecisionCommand; response: ApiSuccess<Invoice> };
  generateReminder: { request: GenerateReminderCommand; response: ApiSuccess<Reminder> };
  sendReminder: { request: SendReminderCommand; response: ApiSuccess<Reminder> };
  createReply: { request: CreateReplyCommand; response: ApiSuccess<ReplyCreatedResult> };
  correctReply: { request: CorrectReplyCommand; response: ApiSuccess<Reply> };
  uploadReceipt: { request: UploadReceiptCommand; response: ApiSuccess<ReceiptUploadedResult> };
  getReceiptImage: { request: undefined; response: AuthorizedImage };
  correctReceipt: { request: CorrectReceiptCommand; response: ApiSuccess<Receipt> };
  importBankStatement: { request: ImportBankStatementCommand; response: ApiSuccess<BankImportResult> };
  runMatch: { request: RunMatchCommand; response: ApiSuccess<MatchResult> };
  approvePayment: { request: VersionedCommand; response: ApiSuccess<PaymentApprovedResult> };
  confirmPromise: { request: ConfirmPromiseCommand; response: ApiSuccess<PromiseConfirmedResult> };
  getForecast: { request: ForecastQuery; response: ApiSuccess<Forecast> };
}

interface EndpointDefinition {
  method: "GET" | "POST" | "PATCH";
  path: string;
  roles: readonly Role[];
  status: "planned" | "implemented";
  successStatus: number;
  format: "json" | "multipart" | "image";
}

export const ENDPOINTS = {
  listDemoUsers: { method: "GET", path: "/api/demo-users", roles: [], status: "implemented", successStatus: 200, format: "json" },
  getWorkspace: { method: "GET", path: "/api/workspace", roles: ["owner", "finance", "pm"], status: "implemented", successStatus: 200, format: "json" },
  completeMilestone: { method: "POST", path: "/api/milestones/:id/complete", roles: ["pm"], status: "implemented", successStatus: 200, format: "json" },
  createInvoiceDraft: { method: "POST", path: "/api/milestones/:id/invoice-draft", roles: ["pm"], status: "implemented", successStatus: 200, format: "json" },
  decideInvoice: { method: "POST", path: "/api/invoices/:id/decision", roles: ["owner"], status: "implemented", successStatus: 200, format: "json" },
  generateReminder: { method: "POST", path: "/api/invoices/:id/reminders", roles: ["finance"], status: "implemented", successStatus: 201, format: "json" },
  sendReminder: { method: "POST", path: "/api/reminders/:id/send", roles: ["finance"], status: "implemented", successStatus: 200, format: "json" },
  createReply: { method: "POST", path: "/api/invoices/:id/replies", roles: ["finance"], status: "implemented", successStatus: 201, format: "json" },
  correctReply: { method: "PATCH", path: "/api/replies/:id/extraction", roles: ["finance"], status: "implemented", successStatus: 200, format: "json" },
  uploadReceipt: { method: "POST", path: "/api/invoices/:id/receipts", roles: ["finance"], status: "implemented", successStatus: 200, format: "multipart" },
  getReceiptImage: { method: "GET", path: "/api/receipts/:id/image", roles: ["owner", "finance", "pm"], status: "implemented", successStatus: 200, format: "image" },
  correctReceipt: { method: "PATCH", path: "/api/receipts/:id/evidence", roles: ["finance"], status: "implemented", successStatus: 200, format: "json" },
  importBankStatement: { method: "POST", path: "/api/bank-statements", roles: ["finance"], status: "implemented", successStatus: 200, format: "multipart" },
  runMatch: { method: "POST", path: "/api/receipts/:id/match", roles: ["finance"], status: "implemented", successStatus: 200, format: "json" },
  approvePayment: { method: "POST", path: "/api/matches/:id/approve-payment", roles: ["finance"], status: "planned", successStatus: 200, format: "json" },
  confirmPromise: { method: "POST", path: "/api/replies/:id/confirm-promise", roles: ["finance"], status: "planned", successStatus: 200, format: "json" },
  getForecast: { method: "GET", path: "/api/forecast", roles: ["owner", "finance", "pm"], status: "planned", successStatus: 200, format: "json" },
} as const satisfies Record<keyof ApiOperations, EndpointDefinition>;
