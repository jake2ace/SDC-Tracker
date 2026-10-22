import type {
  ActivityLog, Client, Company, DemoSettings, DemoUser, Invoice, InvoiceStatus,
  Milestone, MockAccountingReceipt, MockOutboxMessage, Payment, Project, Reminder,
  IsoDate,
} from "./domain";

/** 金额均为整数 sen。此文件声明接口，不声称 HTTP 服务已经实现。 */
export type Scenario = { kind: "on_time" } | { kind: "late"; delayDays: 7 | 14 | "beyond_window" };
export interface ForecastSummary {
  endBalance: number;
  minBalance: number;
  minDate: IsoDate;
  firstBreachDate: IsoDate | null;
  breachDays: number;
  maxGapToSafety: number;
  maxShortfallBelowZero: number;
}
export interface ForecastDay {
  date: IsoDate;
  inflow: number;
  outflow: number;
  balance: number;
  belowSafety: boolean;
  gapToSafety: number;
  shortfallBelowZero: number;
}
export interface CashLine {
  id: string;
  kind: "expected_receipt" | "actual_receipt" | "expense";
  date: IsoDate;
  originalDate: IsoDate;
  /** 收入正数、支出负数 */
  amount: number;
  included: boolean;
  excludeReason: "after_window" | "before_base" | "rejected_draft" | "pushed_beyond_window" | null;
  assumedToday: boolean;
  ref: {
    invoiceId?: string; invoiceNo?: string | null; milestoneName?: string;
    clientName?: string; stage?: string; expenseLabel?: string; paymentId?: string;
  };
}
export interface ForecastResult {
  baseDate: IsoDate;
  endDate: IsoDate;
  days: ForecastDay[];
  openingBalance: number;
  safetyLine: number;
  scenario: Scenario;
  lines: CashLine[];
  summary: ForecastSummary;
}
export interface Overview {
  demoDate: IsoDate;
  companyId: string;
  unpaidAmount: number;
  overdueAmount: number;
  overdueCount: number;
  pendingApprovalCount: number;
  pendingIssueAmount: number;
  forecast: ForecastSummary;
}
export interface Session {
  settings: DemoSettings;
  user: DemoUser;
  company: Company;
  companies: Company[];
  users: DemoUser[];
}
export interface CollectionItem {
  invoice: Invoice;
  client: Client;
  overdueDays: number;
  reminders: Reminder[];
}
export type ErrorCode =
  | "VALIDATION_ERROR" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND"
  | "INVALID_STATE" | "UPSTREAM_FAILED" | "AI_UNAVAILABLE";
export interface ApiError {
  error: { code: ErrorCode; message: string; details: Record<string, unknown> };
}
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  INVALID_STATE: 409, UPSTREAM_FAILED: 502, AI_UNAVAILABLE: 503,
};

type Empty = Record<string, never>;
type Id = { id: string };
/** 请求 JSON 不再套 data；成功结果直接使用 response；错误使用 ApiError。 */
export interface Operation<P, B, Q, R> { params: P; body: B; query: Q; response: R }
export type ForecastQuery = {
  mode?: "fixed" | "rolling";
  scenario?: "on_time" | "late";
  delayDays?: 7 | 14 | "beyond_window";
};
export interface ApiContract {
  "GET /api/demo/session": Operation<Empty, Empty, Empty, Session>;
  "PUT /api/demo/settings": Operation<Empty, Partial<DemoSettings>, Empty, { settings: DemoSettings }>;
  "POST /api/demo/reset": Operation<Empty, Empty, Empty, { settings: DemoSettings }>;
  "GET /api/overview": Operation<Empty, Empty, Empty, Overview>;
  "GET /api/projects": Operation<Empty, Empty, Empty, {
    projects: (Project & { client: Client; milestones: Milestone[]; invoices: Invoice[] })[];
  }>;
  "POST /api/milestones/{id}/complete": Operation<Id, Empty, Empty, {
    milestone: Milestone; invoice: Invoice; created: boolean;
  }>;
  "GET /api/invoices": Operation<Empty, Empty, { status?: InvoiceStatus }, { invoices: Invoice[] }>;
  "GET /api/invoices/{id}": Operation<Id, Empty, Empty, { invoice: Invoice; logs: ActivityLog[] }>;
  "POST /api/invoices/{id}/approve": Operation<Id, Empty, Empty, { invoice: Invoice }>;
  "POST /api/invoices/{id}/reject": Operation<Id, { reason: string }, Empty, { invoice: Invoice }>;
  "POST /api/invoices/{id}/issue": Operation<Id, Empty, Empty, {
    invoice: Invoice; receipt: MockAccountingReceipt;
  }>;
  "POST /api/invoices/{id}/payments": Operation<Id, { receivedAt: IsoDate }, Empty, {
    invoice: Invoice; payment: Payment; cancelledReminders: Reminder[];
  }>;
  "GET /api/collections": Operation<Empty, Empty, { filter?: "overdue" | "unpaid" | "paid" }, {
    items: CollectionItem[];
  }>;
  "POST /api/invoices/{id}/reminders": Operation<Id, { regenerate?: boolean }, Empty, { reminder: Reminder }>;
  "PATCH /api/reminders/{id}": Operation<Id, { subject: string; body: string }, Empty, { reminder: Reminder }>;
  "POST /api/reminders/{id}/send": Operation<Id, Empty, Empty, {
    reminder: Reminder; outbox: MockOutboxMessage;
  }>;
  "GET /api/forecast": Operation<Empty, Empty, ForecastQuery, ForecastResult>;
  "GET /api/activity": Operation<Empty, Empty, { limit?: number }, { logs: ActivityLog[] }>;
}
