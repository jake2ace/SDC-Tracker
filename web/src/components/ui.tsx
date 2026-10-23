import { useId, type ReactNode } from "react";
import type { ClientError } from "../lib/client/types";
import type { InvoiceStatus, MatchVerdict, ProcessingStatus, Role } from "../lib/contract";
import { formatSen } from "../lib/format";
import { msg, useT } from "../i18n";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "pending" | "mock";

/** Status always carries its own words, so color is never the only signal. */
export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>{children}</span>
  );
}

export function Money({ sen, signed, strong }: { sen: number | null | undefined; signed?: boolean; strong?: boolean }) {
  const text = formatSen(sen, { signed });
  return <span className={`money${strong ? " money-strong" : ""}${sen !== null && sen !== undefined && sen < 0 ? " money-negative" : ""}`}>{text}</span>;
}

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  draft: { label: msg("Draft · awaiting Owner"), tone: "pending" },
  issued: { label: msg("Issued · unpaid"), tone: "info" },
  partially_paid: { label: msg("Partially paid"), tone: "warning" },
  paid: { label: msg("Paid in full"), tone: "success" },
  rejected: { label: msg("Rejected"), tone: "danger" },
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const t = useT();
  const s = INVOICE_STATUS[status];
  return <Badge tone={s.tone}>{t(s.label)}</Badge>;
}

export function CollectionBadge({ status }: { status: "not_started" | "active" | "stopped" }) {
  const t = useT();
  if (status === "active") return <Badge tone="info">{t("Collection active")}</Badge>;
  if (status === "stopped") return <Badge tone="success">{t("Collection stopped")}</Badge>;
  return <Badge>{t("Collection not started")}</Badge>;
}

export const PROCESSING: Record<ProcessingStatus, { label: string; tone: Tone; hint: string }> = {
  ready: { label: msg("Extracted"), tone: "info", hint: msg("Fields are usable for checking. This is not proof of payment.") },
  needs_review: { label: msg("Needs review"), tone: "warning", hint: msg("Low confidence or unclear. Check and correct before use.") },
  manual_required: { label: msg("Manual entry needed"), tone: "danger", hint: msg("Automatic extraction was not available. Enter the fields yourself.") },
};

export const VERDICT: Record<MatchVerdict, { label: string; tone: Tone; explain: string }> = {
  confirmed: { label: msg("Confirmed by bank record"), tone: "success", explain: msg("A matching bank credit covers the whole outstanding amount. Finance must still record it.") },
  partial: { label: msg("Partial · bank record found"), tone: "warning", explain: msg("A matching bank credit covers part of the outstanding amount. The rest stays due.") },
  amount_mismatch: { label: msg("Amount mismatch"), tone: "danger", explain: msg("The bank credit and the screenshot show different amounts.") },
  not_in_bank_yet: { label: msg("Not in bank data yet"), tone: "pending", explain: msg("No imported bank credit has this reference yet. This does not mean the customer did not pay.") },
  duplicate: { label: msg("Duplicate evidence"), tone: "danger", explain: msg("This proof or bank credit was already used.") },
  needs_review: { label: msg("Needs review"), tone: "warning", explain: msg("The rules could not decide safely. Fix the evidence or bank data, then run the check again.") },
};

export const REASON_TEXT: Record<string, string> = {
  exact_match: msg("Reference, payer, date and amount all match one bank credit."),
  partial_amount: msg("Bank credit is smaller than the outstanding amount."),
  amount_differs: msg("Screenshot amount and bank amount are not equal (0 sen tolerance)."),
  no_bank_reference: msg("No imported bank credit has this reference."),
  duplicate_image: msg("The same image was already used on another invoice."),
  reused_reference: msg("This reference was already used by an approved payment."),
  credit_already_allocated: msg("This bank credit is already allocated to a payment."),
  missing_field: msg("A required field is missing (bank, amount, reference, time or payer)."),
  invalid_evidence: msg("Evidence values are invalid."),
  low_confidence: msg("Extraction confidence is below 0.85, so a person must review it."),
  manual_review_required: msg("Manual evidence has no server review stamp."),
  wrong_payer: msg("Payer is not one of this customer's registered payer names."),
  multiple_candidates: msg("More than one bank credit could match. The rules will not guess."),
  date_outside_window: msg("Bank posting date is outside 0–2 days after the transfer date."),
  overpayment: msg("Bank credit is larger than the outstanding amount."),
  invoice_not_collectible: msg("This invoice is not open for collection."),
  future_transfer_time: msg("Transfer time is after the current demo clock."),
  future_bank_posting: msg("Bank posting date is in the future."),
};

export const ROLE_LABEL: Record<Role, string> = { owner: msg("Owner"), finance: msg("Finance"), pm: msg("Project manager") };

export function Panel({ title, actions, children, className, subtitle }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`panel ${className ?? ""}`}>
      {(title || actions) && (
        <header className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="muted small">{subtitle}</p>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <div className="muted small">{children}</div>}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  const t = useT();
  return <div className="loading" role="status"><span className="spinner" aria-hidden="true" />{label ?? t("Loading…")}</div>;
}

const ERROR_TITLE: Record<string, string> = {
  FORBIDDEN: msg("Not allowed for this role"),
  NOT_FOUND: msg("Not found"),
  UNAUTHENTICATED: msg("Choose a demo user"),
  VERSION_CONFLICT: msg("Data changed. Refreshed; please review and try again"),
  CREDIT_ALREADY_ALLOCATED: msg("Bank credit already used"),
  DUPLICATE_EVIDENCE: msg("Duplicate evidence"),
  REVIEW_REQUIRED: msg("Review required"),
  VALIDATION_ERROR: msg("Please fix the highlighted values"),
  IDEMPOTENCY_CONFLICT: msg("Request conflict"),
  IDEMPOTENCY_IN_PROGRESS: msg("Still processing"),
  INVALID_STATE: msg("Not possible in the current state"),
  BANK_IMPORT_CONFLICT: msg("Import conflicts with existing bank data"),
  UNSUPPORTED_MEDIA_TYPE: msg("File type not supported"),
  PAYLOAD_TOO_LARGE: msg("File too large"),
};

export function ErrorNote({ error, onRetry, onDismiss, read }: { error: ClientError; onRetry?: () => void; onDismiss?: () => void; read?: boolean }) {
  const t = useT();
  const rawTitle = error.kind === "network" ? msg("Could not reach the service")
    : error.kind === "planned" ? msg("Backend step not available yet")
    : error.kind === "mock_gap" ? msg("Not covered by mock fixtures")
    : error.code ? ERROR_TITLE[error.code] ?? msg("Request failed") : msg("Request failed");
  const title = t(rawTitle);
  // Messages written by this client are translated; server messages are shown as sent.
  const clientText = error.kind === "network" ? msg("Could not reach the service. Retry sends the same request.")
    : error.kind === "planned" ? msg("The backend has not implemented this step yet (planned in contract v1.0.0).")
    : error.kind === "mock_gap" ? msg("Mock only covers the approved fixture requests. Use the prefilled values or the demo scenario runner.")
    : null;
  const tone = error.kind === "planned" || error.kind === "mock_gap" ? "note-mock" : "note-error";
  return (
    <div className={`note ${tone}`} role="alert">
      <div>
        <strong>{title}.</strong> {clientText ? t(clientText) : error.message}{read ? "" : ` ${error.kind === "network" || error.kind === "bad_response" ? t("The result is unknown. Retry the same request to check safely.") : t("Nothing was changed.")}`}
        {clientText && error.kind === "mock_gap" && <div className="tiny">{error.message}</div>}
        {error.details.fieldErrors?.length ? (
          <ul>{error.details.fieldErrors.map((f) => <li key={f.field}><code>{f.field}</code>: {f.message}</li>)}</ul>
        ) : null}
        {error.details.rowNumbers?.length ? <div>Rows: {error.details.rowNumbers.join(", ")}</div> : null}
        <div className="muted tiny">
          {error.status ? `HTTP ${error.status}` : error.kind}{error.code ? ` · ${error.code}` : ""}{error.requestId ? ` · ${error.requestId}` : ""}
        </div>
      </div>
      <div className="note-actions">
        {onRetry && error.retryable && <button className="btn btn-small" onClick={onRetry}>{t("Retry")}</button>}
        {onDismiss && <button className="btn btn-small btn-ghost" onClick={onDismiss}>{t("Dismiss")}</button>}
      </div>
    </div>
  );
}

/** Reason the action button is disabled, shown as text next to it. */
export function ActionHint({ roleAllowed, supported, roles, extra }: {
  roleAllowed: boolean; supported: boolean; roles: readonly string[]; extra?: string | null;
}) {
  const t = useT();
  let text: string | null = null;
  if (!supported) text = t("Planned backend step · not available in live API yet");
  else if (!roleAllowed) text = t("Requires {role} role", { role: roles.map((r) => t(ROLE_LABEL[r as Role])).join(" / ") });
  else if (extra) text = t(extra);
  return text ? <span className="hint">{text}</span> : null;
}

export function Field({ label, children, hint, error }: { label: string; children: (id: string) => ReactNode; hint?: ReactNode; error?: string | null }) {
  const id = useId();
  return (
    <div className={`field${error ? " field-error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <div className="muted tiny">{hint}</div>}
      {error && <div className="field-msg" role="alert">{error}</div>}
    </div>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}

export function Confidence({ value }: { value: number | null }) {
  const t = useT();
  if (value === null) return <span className="muted">{t("Manual (no score)")}</span>;
  const low = value < 0.85;
  return (
    <span className="conf">
      <span className="conf-bar" aria-hidden="true"><span style={{ width: `${Math.round(value * 100)}%` }} className={low ? "low" : ""} /><i /></span>
      <span>{Math.round(value * 100)}%{low ? ` · ${t("below 85% review threshold")}` : ""}</span>
    </span>
  );
}
