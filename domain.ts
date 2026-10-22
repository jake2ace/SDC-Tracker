// Issue #1 共享领域契约；与界面草图使用的字段兼容。
// 金额一律用整数「分」(sen) 存储，避免浮点误差；日期一律用 "YYYY-MM-DD" 字符串。

export type Role = "pm" | "owner" | "finance";

export type IsoDate = string; // YYYY-MM-DD
export type IsoDateTime = string; // ISO 8601

export interface Company {
  id: string;
  /** 用于模拟发票编号前缀，如 SL */
  code: string;
  name: string;
  industry: string;
  currency: "MYR";
  /** 预测基准日当天开始时的银行余额（分） */
  openingBalance: number;
  /** 现金安全线（分） */
  safetyLine: number;
  /** 固定验收案例的预测基准日 */
  forecastBaseDate: IsoDate;
  /** 窗口天数，含首尾 */
  forecastDays: number;
}

export interface DemoUser {
  id: string;
  companyId: string;
  name: string;
  role: Role;
}

export interface Client {
  id: string;
  companyId: string;
  name: string;
  contactName: string;
  email: string;
}

export interface Project {
  id: string;
  companyId: string;
  clientId: string;
  name: string;
  contractTotal: number;
}

export type MilestoneStatus = "pending" | "completed";

/** 付款约定：账期从模拟发票实际开出日起算 */
export interface PaymentTerm {
  amount: number;
  netDays: number;
  dueFrom: "issue_date";
  note: string;
}

/** 公司归属通过 projectId -> Project.companyId 推导；禁止绕过项目的公司检查。 */
export interface Milestone {
  id: string;
  projectId: string;
  seq: number;
  name: string;
  status: MilestoneStatus;
  /** 计划完成日，用于预测还没开票的阶段 */
  plannedDate: IsoDate;
  completedAt: IsoDate | null;
  completedBy: string | null;
  paymentTerm: PaymentTerm;
  /** 演示数据里在系统上线之前就已经收款的阶段 */
  settledBeforeDemo?: boolean;
}

export type InvoiceStatus =
  | "pending_approval" // 草稿，等待 Owner 批准
  | "approved" // 已批准，等待 Finance 发起模拟开票
  | "rejected" // 已驳回，本次处理终止
  | "issued" // 模拟会计接口返回编号，开票成功
  | "paid"; // 已全额收款

export interface Invoice {
  id: string;
  companyId: string;
  projectId: string;
  milestoneId: string;
  clientId: string;
  currency: "MYR";
  amount: number;
  netDays: number;
  /** 草稿生成日 */
  draftedAt: IsoDate;
  /** 草稿生成时的预计到期日 draftedAt + netDays；实际到期日以 issuedAt + netDays 为准。 */
  expectedDueDate: IsoDate;
  status: InvoiceStatus;
  /** 草稿创建时复制付款依据；批准后不可修改，开票必须使用该快照。 */
  basis: {
    projectName: string;
    milestoneName: string;
    termNote: string;
    contractTotal: number;
  };
  approval: { by: string; role: "owner"; at: IsoDateTime; reason?: string } | null;
  /** 开票请求编号，稳定不变，用来防止重复开票 */
  issueRequestId: string;
  issueAttempts: number;
  lastIssueError: string | null;
  invoiceNo: string | null;
  issuedAt: IsoDate | null;
  dueDate: IsoDate | null;
  paidAt: IsoDate | null;
}

export interface Payment {
  id: string;
  companyId: string;
  invoiceId: string;
  amount: number;
  receivedAt: IsoDate;
  recordedBy: string;
}

export type ReminderStatus = "draft" | "sent" | "cancelled";

export interface Reminder {
  id: string;
  companyId: string;
  invoiceId: string;
  status: ReminderStatus;
  /** 第几次提醒 */
  sequence: number;
  tone: "gentle" | "firm" | "final";
  subject: string;
  body: string;
  /** 生成来源：mock_template 表示演示模板，不是真实 AI 输出 */
  source: "mock_template" | "ai";
  /** 生成时引用的事实，用于核对文案 */
  facts: { amount: number; overdueDays: number; dueDate: IsoDate; invoiceNo: string; previousReminders: number };
  createdAt: IsoDateTime;
  createdBy: string;
  editedAt: IsoDateTime | null;
  sentAt: IsoDateTime | null;
  sentBy: string | null;
  sendRequestId: string;
  lastSendError: string | null;
  cancelReason: string | null;
}

export interface PlannedExpense {
  id: string;
  companyId: string;
  date: IsoDate;
  amount: number;
  label: string;
}

export type LogResult = "success" | "failure" | "denied" | "info";

export interface ActivityLog {
  id: string;
  companyId: string;
  at: IsoDateTime;
  demoDate: IsoDate;
  actor: string;
  role: Role | "system";
  action: string;
  entityType: "milestone" | "invoice" | "reminder" | "payment" | "system";
  entityId: string | null;
  result: LogResult;
  message: string;
}

/** 模拟会计适配器的回执，按请求编号保存，重试时取回同一张 */
export interface MockAccountingReceipt {
  requestId: string;
  invoiceNo: string;
  issuedAt: IsoDate;
  dueDate: IsoDate;
  simulation: true;
}

export interface MockOutboxMessage {
  requestId: string;
  reminderId: string;
  to: string;
  subject: string;
  sentAt: IsoDateTime;
  simulation: true;
}

export interface DemoSettings {
  demoDate: IsoDate;
  companyId: string;
  userId: string;
  /** 让下一次模拟接口调用失败，用来演示失败状态 */
  failNext: { accounting: boolean; outbox: boolean };
}

export interface DemoState {
  schemaVersion: 1;
  settings: DemoSettings;
  companies: Company[];
  users: DemoUser[];
  clients: Client[];
  projects: Project[];
  milestones: Milestone[];
  invoices: Invoice[];
  payments: Payment[];
  reminders: Reminder[];
  expenses: PlannedExpense[];
  logs: ActivityLog[];
  mockAccounting: MockAccountingReceipt[];
  mockOutbox: MockOutboxMessage[];
  seq: number;
}
