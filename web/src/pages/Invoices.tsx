import { useRef, useState } from "react";
import { GlassPuck, useGlassPuck } from "../components/Glass";
import { useAction, useSession } from "../lib/session";
import { href, type InvoiceTab } from "../lib/route";
import { formatMytDate, formatSen, formatUtcAsMyt } from "../lib/format";
import { byId, customerName, daysPastDue, isOpen, userName } from "../lib/selectors";
import type { Invoice, Workspace } from "../lib/contract";
import { ActionHint, Badge, Empty, ErrorNote, Field, InvoiceStatusBadge, KeyValue, Money, Panel } from "../components/ui";
import { MessagesTab } from "./invoice/Messages";
import { PaymentTab } from "./invoice/PaymentCheck";
import { useT } from "../i18n";

export function InvoicesPage({ selectedId, tab }: { selectedId: string | null; tab: InvoiceTab }) {
  const t = useT();
  const { workspace: ws } = useSession();
  if (!ws) return null;
  const selected = byId(ws.invoices, selectedId);
  const asOf = ws.forecastDefaults.asOfDate;

  return (
    <div className={`master-detail${selectedId ? " has-detail" : ""}`}>
      <section className="master" aria-label={t("Invoices")}>
        <h1>{t("Invoices")}</h1>
        {ws.invoices.length === 0 ? <Empty title={t("No invoices yet")}>{t("Complete a milestone on Home to create one.")}</Empty> : (
          <ul className="inv-list">
            {ws.invoices.map((inv) => {
              const late = isOpen(inv) ? daysPastDue(inv, asOf) : 0;
              return (
                <li key={inv.id}>
                  <a href={href("invoices", inv.id)} aria-current={inv.id === selectedId ? "true" : undefined}>
                    <span className="inv-top"><b>{inv.number}</b><Money sen={inv.outstandingAmountSen} strong /></span>
                    <span className="inv-sub muted small">{customerName(ws, inv.customerId)}</span>
                    <span className="inv-sub"><InvoiceStatusBadge status={inv.status} />{late > 0 && <span className="late small">{t("{n} days late", { n: late })}</span>}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <div className="detail">
        {selectedId && !selected && <Empty title={t("Invoice not found in this company")} />}
        {!selectedId && <div className="pick-hint muted">{t("Pick an invoice on the left.")}</div>}
        {selected && <InvoiceDetail key={selected.id} ws={ws} inv={selected} tab={tab} />}
      </div>
    </div>
  );
}

function InvoiceDetail({ ws, inv, tab }: { ws: Workspace; inv: Invoice; tab: InvoiceTab }) {
  const t = useT();
  const late = isOpen(inv) ? daysPastDue(inv, ws.forecastDefaults.asOfDate) : 0;
  const project = byId(ws.projects, inv.projectId);
  const collectible = inv.status !== "draft" && inv.status !== "rejected";
  const tabs: { id: InvoiceTab; label: string }[] = [
    { id: "details", label: t("Details") },
    ...(collectible ? [{ id: "messages" as const, label: t("Messages") }, { id: "payment" as const, label: t("Payment check") }] : []),
  ];
  const active = tabs.some((x) => x.id === tab) ? tab : "details";
  const tabRef = useRef<HTMLElement>(null);
  const puck = useGlassPuck(tabRef, active);
  const paidPct = inv.totalAmountSen > 0 ? Math.min(100, Math.round((inv.paidAmountSen * 100) / inv.totalAmountSen)) : 0;

  return (
    <article className="invoice">
      <a className="back-link" href={href("invoices")}>← {t("All invoices")}</a>
      <header className="inv-head">
        <div>
          <h2>{inv.number}</h2>
          <p className="muted">{customerName(ws, inv.customerId)} · {project?.name}</p>
        </div>
        <div className="row gap wrap">
          <InvoiceStatusBadge status={inv.status} />
          {late > 0 && <Badge tone="warning">{t("{n} days late", { n: late })}</Badge>}
        </div>
      </header>

      <div className="amounts">
        <div><span>{t("Total")}</span><Money sen={inv.totalAmountSen} strong /></div>
        <div><span>{t("Received")}</span><Money sen={inv.paidAmountSen} strong /></div>
        <div className="key"><span>{t("Still due")}</span><Money sen={inv.outstandingAmountSen} strong /></div>
      </div>
      <div className="progress" role="img" aria-label={t("{n}% of the invoice received", { n: paidPct })}><span style={{ width: `${paidPct}%` }} /></div>

      <nav ref={tabRef} className="tabs glass-track" aria-label={t("Invoice sections")}>
        <GlassPuck style={puck} />
        {tabs.map((x) => (
          <a key={x.id} href={href("invoices", inv.id, x.id)} aria-current={active === x.id ? "page" : undefined}>{x.label}</a>
        ))}
      </nav>

      {active === "details" && <DetailsTab ws={ws} inv={inv} />}
      {active === "messages" && <MessagesTab ws={ws} inv={inv} />}
      {active === "payment" && <PaymentTab ws={ws} inv={inv} />}
    </article>
  );
}

function DetailsTab({ ws, inv }: { ws: Workspace; inv: Invoice }) {
  const t = useT();
  const { users } = useSession();
  const milestone = byId(ws.milestones, inv.milestoneId);
  const payments = ws.payments.filter((p) => p.invoiceId === inv.id);
  const promise = byId(ws.promises, inv.confirmedPromiseId);
  const collection = inv.collectionStatus === "active" ? t("Active") : inv.collectionStatus === "stopped" ? t("Stopped, paid in full") : t("Not started");

  return (
    <div className="tab-body">
      {inv.status === "draft" && <OwnerDecision inv={inv} />}
      {inv.status === "partially_paid" && <p className="note note-warning">{t("Part of this invoice is paid. {amount} is still due and reminders continue.", { amount: formatSen(inv.outstandingAmountSen) })}</p>}
      {inv.status === "rejected" && <p className="note note-error">{t("The Owner rejected this draft. It will not be sent or collected.")}</p>}

      <KeyValue items={[
        [t("Milestone"), milestone?.title ?? "—"],
        [t("Due date"), formatMytDate(inv.dueDate, true)],
        [t("Issued"), inv.issuedAt ? formatUtcAsMyt(inv.issuedAt) : t("Not issued")],
        [t("Approved by"), userName(ws, inv.approvedBy, users)],
        [t("Reminders"), collection],
        [t("Promised payment"), promise?.status === "active" ? <>{formatMytDate(promise.promisedDate, true)} · <Money sen={inv.outstandingAmountSen} /> <span className="muted small">({t("expected, not received")})</span></> : promise?.status === "fulfilled" ? t("This payment promise has been fulfilled.") : t("None")],
      ]} />

      <h3 className="section-title">{t("Payments received")}</h3>
      {payments.length === 0 ? <p className="muted">{t("No payment recorded yet.")}</p> : (
        <ul className="rows">
          {payments.map((p) => (
            <li key={p.id}>
              <div className="row-main">
                <div>
                  <div>{formatUtcAsMyt(p.confirmedAt)}</div>
                  <div className="muted small">{t("Bank posted {date} · recorded by {name}", { date: formatMytDate(p.bankPostedDate), name: userName(ws, p.confirmedBy, users) })}</div>
                </div>
                <Money sen={p.amountSen} strong />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OwnerDecision({ inv }: { inv: Invoice }) {
  const t = useT();
  const decide = useAction("decideInvoice");
  const [mode, setMode] = useState<"idle" | "reject">("idle");
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const disabled = !decide.roleAllowed || !decide.supported || decide.pending;
  const approve = () => decide.run({ id: inv.id, body: { expectedVersion: inv.version, decision: "approve", reason: null } }, t("{number} approved and issued.", { number: inv.number }));
  const reject = () => {
    if (!reason.trim()) { setReasonError(t("Enter a reason for rejecting.")); return; }
    if (reason.length > 500) { setReasonError(t("Keep the reason under 500 characters.")); return; }
    setReasonError(null);
    void decide.run({ id: inv.id, body: { expectedVersion: inv.version, decision: "reject", reason: reason.trim() } }, t("{number} rejected.", { number: inv.number }));
  };

  return (
    <Panel title={t("Waiting for Owner approval")} className="callout">
      <p className="muted small">{t("Nothing is sent to the customer until the Owner approves.")}</p>
      {decide.error && <ErrorNote error={decide.error} onRetry={() => void (mode === "reject" ? reject() : approve())} onDismiss={decide.clearError} />}
      {mode === "idle" ? (
        <div className="row gap wrap">
          <button className="btn btn-primary" disabled={disabled} onClick={() => void approve()}>{decide.pending ? t("Approving…") : t("Approve and issue")}</button>
          <button className="btn btn-danger-outline" disabled={disabled} onClick={() => setMode("reject")}>{t("Reject…")}</button>
          <ActionHint {...decide} />
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); reject(); }}>
          <Field label={t("Reason for rejecting")} error={reasonError}>
            {(id) => <textarea id={id} rows={2} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} autoFocus />}
          </Field>
          <div className="row gap">
            <button type="submit" className="btn btn-danger" disabled={disabled}>{decide.pending ? t("Rejecting…") : t("Reject draft")}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode("idle")}>{t("Cancel")}</button>
          </div>
        </form>
      )}
    </Panel>
  );
}

