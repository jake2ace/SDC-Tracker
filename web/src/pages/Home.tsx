import { useState, type ReactNode } from "react";
import { useSession, useAction } from "../lib/session";
import { href } from "../lib/route";
import { formatMytDate, formatUtcAsMyt } from "../lib/format";
import { byId, customerName, daysPastDue, isOpen } from "../lib/selectors";
import { ActionHint, Badge, Empty, ErrorNote, Money, Panel, ROLE_LABEL } from "../components/ui";
import type { Milestone, Workspace } from "../lib/contract";
import { useT } from "../i18n";
import { todos, type Todo, type WorkKind } from "../lib/tasks";
import "./Home.css";

function HomeIcon({ kind }: { kind: "wallet" | "clock" | "check" | "file" | "arrow" | "project" }) {
  const paths = {
    wallet: <><path d="M4 7h15a1 1 0 0 1 1 1v11H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13v3" /><path d="M20 11h-6v5h6M16 13.5h.1" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="m8 12 3 3 5-6" /></>,
    file: <><path d="M14 3H5v18h14V8Z" /><path d="M14 3v5h5M8 12h8M8 16h5" /></>,
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    project: <><path d="M3 7h7l2 2h9v11H3Z" /><path d="M3 7V4h7l2 3h8v2" /></>,
  };
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

function Metric({ label, value, detail, icon, tone, link, onClick }: { label: string; value: ReactNode; detail: string; icon: "wallet" | "clock" | "check" | "file"; tone?: string; link?: string; onClick?: () => void }) {
  const content = <><span className="home-metric-top"><span>{label}</span><span className={`home-icon ${tone ?? ""}`}><HomeIcon kind={icon} /></span></span><strong className="home-metric-value">{value}</strong><span className="home-metric-detail">{detail}<HomeIcon kind="arrow" /></span></>;
  return link ? <a className="home-metric" href={link}>{content}</a> : <button className="home-metric" onClick={onClick}>{content}</button>;
}

export function HomePage() {
  const t = useT();
  const { workspace: ws, actor } = useSession();
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [kind, setKind] = useState<"all" | WorkKind>("all");
  if (!ws || !actor) return null;
  const asOf = ws.forecastDefaults.asOfDate;
  const open = ws.invoices.filter(isOpen);
  const overdue = open.filter((i) => daysPastDue(i, asOf) > 0);
  const outstanding = open.reduce((s, i) => s + i.outstandingAmountSen, 0);
  const late = overdue.reduce((s, i) => s + i.outstandingAmountSen, 0);
  const all = todos(ws, t);
  const mine = all.filter((x) => x.role === actor.role);
  const items = (scope === "mine" ? mine : all).filter((x) => kind === "all" || x.kind === kind);
  const receiptCount = all.filter((x) => x.kind === "evidence").length;
  const draftCount = ws.invoices.filter((i) => i.status === "draft").length;
  const scrollToQueue = (filter: "all" | WorkKind) => { setScope("team"); setKind(filter); document.getElementById("home-work-queue")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const openTask = (item: Todo) => { if (item.kind === "milestone") document.getElementById("home-projects")?.scrollIntoView({ behavior: "smooth" }); else window.location.hash = item.link.slice(1); };
  return <div className="home-dashboard">
    <header className="home-heading"><div><p className="home-eyebrow">{ws.company.name} <span> / </span> {t("Overview")}</p><h1>{t("Your collection workspace")}</h1><p className="home-intro">{t("Keep projects moving. Turn payment evidence into confirmed receipts.")}</p></div><div className="home-heading-actions"><span className="home-date"><HomeIcon kind="clock" />{t("As of {date}", { date: formatMytDate(asOf) })}</span><a className="btn btn-primary" href={href("invoices")}>{t("Open invoices")}<HomeIcon kind="arrow" /></a></div></header>
    <div className="home-metrics">
      <Metric label={t("Still to collect")} value={<Money sen={outstanding} />} detail={t("{n} open invoices", { n: open.length })} icon="wallet" link={href("invoices")} />
      <Metric label={t("Past due")} value={<Money sen={late} />} detail={t("{n} invoices past their due date", { n: overdue.length })} icon="clock" tone="home-icon-warning" link={overdue.length ? href("invoices", [...overdue].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0].id) : href("invoices")} />
      <Metric label={t("Evidence to review")} value={receiptCount} detail={t("Screenshots awaiting Finance review")} icon="check" tone="home-icon-info" onClick={() => scrollToQueue("evidence")} />
      <Metric label={t("Awaiting approval")} value={draftCount} detail={t("Invoice drafts for the Owner")} icon="file" tone="home-icon-pending" onClick={() => scrollToQueue("invoice")} />
    </div>
    <div className="home-main-grid">
      <Panel className="home-queue" title={t("What needs your attention")} subtitle={t("Review evidence first, then keep invoices and follow-ups moving.")} actions={<span className="home-count">{items.length}</span>}>
        <div id="home-work-queue" className="home-queue-anchor" />
        <div className="home-queue-toolbar"><div className="home-switch" role="group" aria-label={t("Task ownership")}><button type="button" aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>{t("Assigned to you")} <span>{mine.length}</span></button><button type="button" aria-pressed={scope === "team"} onClick={() => setScope("team")}>{t("Whole team")} <span>{all.length}</span></button></div><label className="home-filter"><span className="home-sr-only">{t("Filter work type")}</span><select value={kind} onChange={(e) => setKind(e.target.value as "all" | WorkKind)}><option value="all">{t("All work")}</option><option value="evidence">{t("Payment evidence")}</option><option value="invoice">{t("Invoice approvals")}</option><option value="followup">{t("Customer follow-ups")}</option><option value="milestone">{t("Milestone billing")}</option></select></label></div>
        {items.length === 0 ? <div className="home-clear"><span className="home-clear-icon"><HomeIcon kind="check" /></span><h3>{t("No tasks in this view")}</h3><p>{t("Try another filter or check the team's work.")}</p>{scope === "mine" && all.length > 0 && <button className="btn btn-small" onClick={() => { setScope("team"); setKind("all"); }}>{t("View team tasks")}</button>}</div> : <><ul className="home-work-list">{items.map((item) => <li key={item.id}><a href={item.link} onClick={item.kind === "milestone" ? (e) => { e.preventDefault(); openTask(item); } : undefined}><span className={`home-work-icon home-work-${item.kind}`}><HomeIcon kind={item.kind === "evidence" ? "check" : item.kind === "followup" ? "clock" : "file"} /></span><span className="home-work-copy"><strong>{item.text}</strong>{item.excerpt && <span className="home-work-excerpt">{item.excerpt}</span>}<span>{item.invoice ? `${customerName(ws, item.invoice.customerId)} · ${item.invoice.number}` : item.projectTitle}<span className="home-work-role">{t(ROLE_LABEL[item.role])}</span></span></span><HomeIcon kind="arrow" /></a></li>)}</ul><button className="btn btn-primary home-start-task" onClick={() => openTask(items[0])}>{t("Open first task")}<HomeIcon kind="arrow" /></button></>}
        <div className="home-role-note"><span className="home-status-dot" />{actor.displayName} · {t(ROLE_LABEL[actor.role])}<span>{t("Actions follow your role permissions.")}</span></div>
      </Panel>
      <CollectionOverview ws={ws} />
    </div>
    <div className="home-bottom-grid"><Milestones ws={ws} /><Panel className="home-activity" title={t("Recent activity")} actions={<a className="home-text-link" href={href("activity")}>{t("View all")} <span aria-hidden="true">↗</span></a>}>
      {ws.activityLog.length === 0 ? <Empty title={t("No activity yet")}><p>{t("Approvals, checks and recorded payments will appear here.")}</p></Empty> : <ol className="home-activity-list">{[...ws.activityLog].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 5).map((event) => <li key={event.id}><span className={`home-activity-dot ${event.outcome === "rejected" ? "home-activity-rejected" : ""}`} /><div><p>{event.summary}</p><time dateTime={event.occurredAt}>{formatUtcAsMyt(event.occurredAt)}</time>{event.outcome === "rejected" && <Badge tone="warning">{t("Rejected")}</Badge>}</div></li>)}</ol>}
      <a className="home-audit-link" href={href("activity")}><HomeIcon kind="file" /><span>{t("Every decision leaves a trace")}</span><HomeIcon kind="arrow" /></a>
    </Panel></div>
  </div>;
}

function CollectionOverview({ ws }: { ws: Workspace }) {
  const t = useT();
  const issued = ws.invoices.filter((i) => isOpen(i) || i.status === "paid");
  const total = issued.reduce((sum, i) => sum + i.totalAmountSen, 0);
  const paid = issued.reduce((sum, i) => sum + i.paidAmountSen, 0);
  const remaining = issued.reduce((sum, i) => sum + i.outstandingAmountSen, 0);
  const percent = total > 0 ? Math.round(paid / total * 100) : 0;
  const states = [{ name: t("Issued · unpaid"), count: issued.filter((i) => i.status === "issued").length, className: "home-state-open" }, { name: t("Partially paid"), count: issued.filter((i) => i.status === "partially_paid").length, className: "home-state-partial" }, { name: t("Paid in full"), count: issued.filter((i) => i.status === "paid").length, className: "home-state-paid" }];
  return <Panel className="home-collection" title={t("Collection progress")} actions={<a className="home-text-link" href={href("cash")}>{t("Cash forecast")} <span aria-hidden="true">↗</span></a>}>
    <div className="home-progress-value"><strong>{total > 0 ? `${percent}%` : "—"}</strong><span>{t("of issued invoice value recorded as paid")}</span></div>
    <div className="home-payment-progress" role="img" aria-label={t("{percent}% of issued invoice value recorded as paid", { percent })}><span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></div>
    <dl className="home-amount-breakdown"><div><dt><span className="home-legend-dot home-state-paid" />{t("Recorded payments")}</dt><dd><Money sen={paid} /></dd></div><div><dt><span className="home-legend-dot home-state-open" />{t("Still to collect")}</dt><dd><Money sen={remaining} /></dd></div></dl>
    <div className="home-state-list">{states.map((state) => <div key={state.className}><span className={`home-legend-dot ${state.className}`} /><span>{state.name}</span><strong>{state.count}</strong></div>)}</div>
    <div className="home-proof-note"><HomeIcon kind="check" /><div><strong>{t("A screenshot is a claim, not a receipt.")}</strong><p>{t("Only bank-backed payments confirmed by Finance reduce the amount due.")}</p></div></div>
  </Panel>;
}

function Milestones({ ws }: { ws: Workspace }) {
  const t = useT();
  return <Panel className="home-projects" title={t("Projects & milestones")} subtitle={t("Complete the work, then move it into billing.")} actions={<Badge>{t("{n} projects", { n: ws.projects.length })}</Badge>}>
    <div id="home-projects" className="home-queue-anchor" />{ws.projects.length === 0 && <Empty title={t("No projects yet")} />}
    {ws.projects.map((p) => {
      const milestones = p.milestoneIds.map((id) => byId(ws.milestones, id)).filter((m): m is Milestone => Boolean(m));
      const completed = milestones.filter((m) => m.status === "completed").length;
      return <div key={p.id} className="home-project"><div className="home-project-head"><span className="home-project-icon"><HomeIcon kind="project" /></span><div><h3>{p.name}</h3><p>{customerName(ws, p.customerId)}</p></div><span className="home-project-fraction">{completed}<span> / {milestones.length}</span></span></div><div className="home-milestone-progress" role="img" aria-label={t("{completed} of {total} milestones completed", { completed, total: milestones.length })}>{milestones.map((m) => <span key={m.id} className={m.status === "completed" ? "is-complete" : ""} />)}</div><ul className="rows home-milestone-rows">{milestones.map((m) => <MilestoneRow key={m.id} ws={ws} m={m} />)}</ul></div>;
    })}
  </Panel>;
}

function MilestoneRow({ ws, m }: { ws: Workspace; m: Milestone }) {
  const t = useT();
  const complete = useAction("completeMilestone");
  const draft = useAction("createInvoiceDraft");
  const inv = byId(ws.invoices, m.invoiceId);
  const doComplete = () => complete.run({ id: m.id, body: { expectedVersion: m.version } }, t("Milestone \"{title}\" marked complete.", { title: m.title }));
  const doDraft = () => draft.run({ id: m.id, body: { expectedVersion: m.version } }, t("Invoice draft created. Waiting for Owner approval."));
  return <li><div className="row-main"><div><div className="home-milestone-title"><span className={`home-milestone-dot ${m.status === "completed" ? "is-complete" : ""}`} />{m.title}</div><div className="muted small">{t("Due {date}", { date: formatMytDate(m.dueDate) })} · {m.status === "completed" ? t("Completed") : t("Planned")}</div></div><Money sen={m.amountSen} /></div><div className="row gap wrap">
    {inv && <a className="home-text-link" href={href("invoices", inv.id)}>{t("Invoice {number}", { number: inv.number })} <span aria-hidden="true">↗</span></a>}
    {m.status === "planned" && <><button className="btn btn-small" disabled={!complete.roleAllowed || !complete.supported || complete.pending} onClick={() => void doComplete()}>{complete.pending ? t("Saving…") : t("Mark complete")}</button><ActionHint {...complete} /></>}
    {m.status === "completed" && !m.invoiceId && <><button className="btn btn-small btn-primary" disabled={!draft.roleAllowed || !draft.supported || draft.pending} onClick={() => void doDraft()}>{draft.pending ? t("Creating…") : t("Create invoice draft")}</button><ActionHint {...draft} /></>}
    </div>{complete.error && <ErrorNote error={complete.error} onRetry={() => void doComplete()} onDismiss={complete.clearError} />}{draft.error && <ErrorNote error={draft.error} onRetry={() => void doDraft()} onDismiss={draft.clearError} />}</li>;
}
