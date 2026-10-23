import { useSession, useAction } from "../lib/session";
import { href } from "../lib/route";
import { formatMytDate } from "../lib/format";
import { byId, customerName, daysPastDue, isOpen } from "../lib/selectors";
import { ActionHint, Badge, Empty, ErrorNote, Money, Panel, ROLE_LABEL } from "../components/ui";
import type { Milestone, Role, Workspace } from "../lib/contract";
import { useT, type T } from "../i18n";

interface Todo { text: string; role: Role; link: string }

/** Open work derived from the server workspace. Nothing here decides money or matches. */
function todos(ws: Workspace, t: T): Todo[] {
  const asOf = ws.forecastDefaults.asOfDate;
  const out: Todo[] = [];
  for (const m of ws.milestones.filter((m) => m.status === "completed" && !m.invoiceId)) out.push({ role: "pm", text: t("Create the invoice for \"{title}\"", { title: m.title }), link: href("home") });
  for (const inv of ws.invoices.filter((i) => i.status === "draft")) out.push({ role: "owner", text: t("Approve invoice {number}", { number: inv.number }), link: href("invoices", inv.id) });
  for (const inv of ws.invoices.filter((i) => isOpen(i) && daysPastDue(i, asOf) > 0 && !ws.reminders.some((r) => r.invoiceId === i.id))) {
    out.push({ role: "finance", text: t("{number} is {n} days late. Send a reminder", { number: inv.number, n: daysPastDue(inv, asOf) }), link: href("invoices", inv.id, "messages") });
  }
  for (const r of ws.reminders.filter((r) => r.status === "draft")) out.push({ role: "finance", text: t("Check and send the reminder for {number}", { number: byId(ws.invoices, r.invoiceId)?.number ?? "" }), link: href("invoices", r.invoiceId, "messages") });
  for (const r of ws.replies.filter((r) => r.processingStatus !== "ready")) out.push({ role: "finance", text: t("Read a customer reply that needs checking"), link: href("invoices", r.invoiceId, "messages") });
  for (const r of ws.replies.filter((r) => r.processingStatus === "ready" && r.extraction?.intent === "promise" && !r.confirmedPromiseId)) out.push({ role: "finance", text: t("Confirm the payment date the customer promised"), link: href("invoices", r.invoiceId, "messages") });
  for (const r of ws.receipts.filter((r) => r.processingStatus !== "ready")) out.push({ role: "finance", text: t("Check the fields read from a payment screenshot"), link: href("invoices", r.invoiceId, "payment") });
  for (const m of ws.matches.filter((m) => m.status === "pending")) {
    const ok = m.verdict === "confirmed" || m.verdict === "partial";
    out.push({ role: "finance", text: ok ? t("Record a payment that matched the bank") : t("A bank check needs your review"), link: href("invoices", m.invoiceId, "payment") });
  }
  return out;
}

export function HomePage() {
  const t = useT();
  const { workspace: ws, actor } = useSession();
  if (!ws || !actor) return null;
  const asOf = ws.forecastDefaults.asOfDate;
  const open = ws.invoices.filter(isOpen);
  const outstanding = open.reduce((s, i) => s + i.outstandingAmountSen, 0);
  const late = open.filter((i) => daysPastDue(i, asOf) > 0).reduce((s, i) => s + i.outstandingAmountSen, 0);
  const all = todos(ws, t);
  const mine = all.filter((x) => x.role === actor.role);
  const others = all.filter((x) => x.role !== actor.role);

  return (
    <>
      <header className="page-head">
        <h1>{ws.company.name}</h1>
        <p className="muted">{actor.displayName} · {t(ROLE_LABEL[actor.role])}</p>
      </header>

      <div className="stats">
        <a className="stat" href={href("invoices")}><span>{t("Still to collect")}</span><Money sen={outstanding} strong /></a>
        <a className="stat" href={href("invoices")}><span>{t("Past due")}</span><Money sen={late} strong /></a>
        <a className="stat" href={href("cash")}><span>{t("Start balance")}</span><Money sen={ws.forecastDefaults.openingBalanceSen} strong /></a>
      </div>

      <Panel title={t("Your to-do")}>
        {mine.length === 0 ? <Empty title={t("Nothing for you right now")} /> : (
          <ul className="todo">
            {mine.map((x, i) => <li key={i}><a href={x.link}><span>{x.text}</span><span aria-hidden="true">→</span></a></li>)}
          </ul>
        )}
        {others.length > 0 && (
          <details className="others">
            <summary>{t("Waiting on others ({n})", { n: others.length })}</summary>
            <ul className="todo muted-list">
              {others.map((x, i) => <li key={i}><a href={x.link}><span>{x.text}</span><Badge>{t(ROLE_LABEL[x.role])}</Badge></a></li>)}
            </ul>
          </details>
        )}
      </Panel>

      <Milestones ws={ws} />
    </>
  );
}

function Milestones({ ws }: { ws: Workspace }) {
  const t = useT();
  return (
    <Panel title={t("Projects")}>
      {ws.projects.length === 0 && <Empty title={t("No projects yet")} />}
      {ws.projects.map((p) => (
        <div key={p.id} className="project">
          <h3>{p.name} <span className="muted small">· {customerName(ws, p.customerId)}</span></h3>
          <ul className="rows">
            {p.milestoneIds.map((id) => byId(ws.milestones, id)).filter((m): m is Milestone => Boolean(m)).map((m) => (
              <MilestoneRow key={m.id} ws={ws} m={m} />
            ))}
          </ul>
        </div>
      ))}
    </Panel>
  );
}

function MilestoneRow({ ws, m }: { ws: Workspace; m: Milestone }) {
  const t = useT();
  const complete = useAction("completeMilestone");
  const draft = useAction("createInvoiceDraft");
  const inv = byId(ws.invoices, m.invoiceId);
  const doComplete = () => complete.run({ id: m.id, body: { expectedVersion: m.version } }, t("Milestone \"{title}\" marked complete.", { title: m.title }));
  const doDraft = () => draft.run({ id: m.id, body: { expectedVersion: m.version } }, t("Invoice draft created. Waiting for Owner approval."));
  return (
    <li>
      <div className="row-main">
        <div>
          <div>{m.title}</div>
          <div className="muted small">{t("Due {date}", { date: formatMytDate(m.dueDate) })} · {m.status === "completed" ? t("Completed") : t("Planned")}</div>
        </div>
        <Money sen={m.amountSen} />
      </div>
      <div className="row gap wrap">
        {inv && <a href={href("invoices", inv.id)}>{t("Invoice {number}", { number: inv.number })}</a>}
        {m.status === "planned" && (
          <>
            <button className="btn btn-small" disabled={!complete.roleAllowed || !complete.supported || complete.pending} onClick={() => void doComplete()}>
              {complete.pending ? t("Saving…") : t("Mark complete")}
            </button>
            <ActionHint {...complete} />
          </>
        )}
        {m.status === "completed" && !m.invoiceId && (
          <>
            <button className="btn btn-small btn-primary" disabled={!draft.roleAllowed || !draft.supported || draft.pending} onClick={() => void doDraft()}>
              {draft.pending ? t("Creating…") : t("Create invoice draft")}
            </button>
            <ActionHint {...draft} />
          </>
        )}
      </div>
      {complete.error && <ErrorNote error={complete.error} onRetry={() => void doComplete()} onDismiss={complete.clearError} />}
      {draft.error && <ErrorNote error={draft.error} onRetry={() => void doDraft()} onDismiss={draft.clearError} />}
    </li>
  );
}
