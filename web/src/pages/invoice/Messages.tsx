import { useState } from "react";
import { useAction, useSession } from "../../lib/session";
import type { Invoice, Language, Reminder, Reply, ReplyIntent, Workspace } from "../../lib/contract";
import { formatMytDate, formatSen, formatUtcAsMyt, mytLocalInputToUtc, parseRinggitToSen, senToInput, utcToMytLocalInput } from "../../lib/format";
import { byId, daysPastDue, isOpen, userName } from "../../lib/selectors";
import { ActionHint, Badge, ErrorNote, Field, PROCESSING } from "../../components/ui";
import { msg, useT } from "../../i18n";

const LANG_LABEL: Record<Language, string> = { en: msg("English"), ms: msg("Bahasa Melayu"), zh: msg("Chinese") };

type Item = { kind: "reminder"; at: string; r: Reminder } | { kind: "reply"; at: string; r: Reply };

/** One conversation per invoice: our reminders (right) and the customer's replies (left). */
export function MessagesTab({ ws, inv }: { ws: Workspace; inv: Invoice }) {
  const t = useT();
  const [composer, setComposer] = useState<"none" | "reply" | "reminder">("none");
  const items: Item[] = [
    ...ws.reminders.filter((r) => r.invoiceId === inv.id).map((r) => ({ kind: "reminder" as const, at: r.sentAt ?? r.createdAt, r })),
    ...ws.replies.filter((r) => r.invoiceId === inv.id).map((r) => ({ kind: "reply" as const, at: r.receivedAt, r })),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.r.id.localeCompare(b.r.id));
  const open = isOpen(inv);

  return (
    <div className="tab-body">
      {items.length === 0 && <p className="muted center">{t("No messages yet.")}</p>}
      <ol className="thread">
        {items.map((it) => it.kind === "reminder"
          ? <ReminderBubble key={it.r.id} ws={ws} inv={inv} r={it.r} />
          : <ReplyBubble key={it.r.id} ws={ws} inv={inv} reply={it.r} />)}
      </ol>
      {open && composer === "none" && (
        <div className="row gap wrap composer-actions">
          <button className="btn" onClick={() => setComposer("reply")}>{t("Add customer reply")}</button>
          <button className="btn" onClick={() => setComposer("reminder")}>{t("Draft a reminder")}</button>
        </div>
      )}
      {composer === "reply" && <AddReply inv={inv} onClose={() => setComposer("none")} />}
      {composer === "reminder" && <NewReminder ws={ws} inv={inv} onClose={() => setComposer("none")} />}
    </div>
  );
}

function NewReminder({ ws, inv, onClose }: { ws: Workspace; inv: Invoice; onClose: () => void }) {
  const t = useT();
  const customer = byId(ws.customers, inv.customerId);
  const gen = useAction("generateReminder");
  const [language, setLanguage] = useState<Language>(customer?.preferredLanguage ?? "en");
  const late = daysPastDue(inv, ws.forecastDefaults.asOfDate);
  const blocked = inv.collectionStatus !== "active" ? msg("Collection is not active for this invoice")
    : late <= 0 ? msg("Reminders open after the due date") : null;
  const generate = () => gen.run({ id: inv.id, body: { expectedVersion: inv.version, language } }, t("Reminder draft ready. Nothing was sent.")).then((r) => { if (r) onClose(); });
  return (
    <div className="composer">
      <h3>{t("Draft a reminder")}</h3>
      {gen.error && <ErrorNote error={gen.error} onRetry={() => void generate()} onDismiss={gen.clearError} />}
      <div className="row gap wrap align-end">
        <Field label={t("Message language")}>
          {(id) => (
            <select id={id} value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              {(Object.keys(LANG_LABEL) as Language[]).map((l) => <option key={l} value={l}>{t(LANG_LABEL[l])}{customer?.preferredLanguage === l ? ` (${t("customer preference")})` : ""}</option>)}
            </select>
          )}
        </Field>
        <button className="btn btn-primary" disabled={!gen.roleAllowed || !gen.supported || gen.pending || Boolean(blocked)} onClick={() => void generate()}>{gen.pending ? t("Drafting…") : t("Write draft")}</button>
        <button className="btn btn-ghost" onClick={onClose}>{t("Cancel")}</button>
      </div>
      <ActionHint {...gen} extra={blocked} />
      <p className="muted small">{t("You can edit the draft before sending. Sending is simulated.")}</p>
    </div>
  );
}

function ReminderBubble({ ws, inv, r }: { ws: Workspace; inv: Invoice; r: Reminder }) {
  const t = useT();
  const { users } = useSession();
  const send = useAction("sendReminder");
  const [text, setText] = useState(r.draftText);
  const tooLong = text.length > 2000;
  const empty = text.trim().length === 0;
  const collectionOpen = isOpen(inv) && inv.collectionStatus === "active";
  const source = r.generationMode === "ai" ? t("AI draft") : r.generationMode === "fallback_template" ? t("Template") : t("Manual");
  const doSend = () => send.run({ id: r.id, body: { expectedVersion: r.version, expectedInvoiceVersion: inv.version, text } }, t("Reminder marked as sent (simulated). No message left this app."));

  if (r.status === "sent_simulated") {
    return (
      <li className="bubble out">
        <div className="bubble-meta">{t("Reminder")} · {formatUtcAsMyt(r.sentAt)} · {t("by {name}", { name: userName(ws, r.approvedBy, users) })}</div>
        <div className="bubble-text">{r.draftText}</div>
        <div className="bubble-foot"><Badge tone="success">{t("Sent (simulated)")}</Badge><span className="muted tiny">{source} · {t(LANG_LABEL[r.language])}</span></div>
      </li>
    );
  }
  return (
    <li className="bubble out draft">
      <div className="bubble-meta">{t("Reminder draft")} · {source} · {t(LANG_LABEL[r.language])}</div>
      {send.error && <ErrorNote error={send.error} onRetry={() => void doSend()} onDismiss={send.clearError} />}
      {!collectionOpen && <p className="note note-info">{t("Collection has stopped. This unsent draft is kept for history.")}</p>}
      {send.error?.code === "VERSION_CONFLICT" && <p className="note note-warning">{t("The invoice changed. Create and review a new reminder for the current balance.")}</p>}
      <form onSubmit={(e) => { e.preventDefault(); if (collectionOpen && !empty && !tooLong) void doSend(); }}>
        <Field label={t("Edit before sending")} error={tooLong ? t("Keep the message under 2,000 characters.") : empty ? t("Message cannot be empty.") : null}>
          {(id) => <textarea id={id} rows={3} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
        <div className="row gap wrap">
          <button type="submit" className="btn btn-primary btn-small" disabled={!collectionOpen || !send.roleAllowed || !send.supported || send.pending || empty || tooLong}>
            {send.pending ? t("Sending…") : t("Send (simulated)")}
          </button>
          <ActionHint {...send} />
        </div>
      </form>
    </li>
  );
}

function ReplyBubble({ ws, inv, reply }: { ws: Workspace; inv: Invoice; reply: Reply }) {
  const t = useT();
  const { users } = useSession();
  const [editing, setEditing] = useState(false);
  const p = PROCESSING[reply.processingStatus];
  const ex = reply.extraction;
  const promise = byId(ws.promises, reply.confirmedPromiseId);
  const facts = ex ? [
    t(INTENT_LABEL[ex.intent]),
    ex.amountSen !== null ? formatSen(ex.amountSen) : null,
    ex.promisedDate ? formatMytDate(ex.promisedDate, true) : null,
    ex.source === "ai" ? (ex.confidence !== null ? t("AI confidence: {n}%", { n: Math.round(ex.confidence * 100) }) : t("read by AI"))
      : t("checked by {name}", { name: userName(ws, ex.reviewedBy, users) }),
  ].filter(Boolean).join(" · ") : null;
  return (
    <li className="bubble in">
      <div className="bubble-meta">{t("Customer")} · {formatUtcAsMyt(reply.receivedAt)}{reply.receiptId ? ` · ${t("screenshot attached")}` : ""}</div>
      <div className="bubble-text">{reply.text}</div>
      <div className="bubble-foot">
        {reply.processingStatus !== "ready" && <Badge tone={p.tone}>{t(p.label)}</Badge>}
        <span className="small">{facts ?? t("Not read yet. Enter what the customer said.")}</span>
        {!promise && <button className="link-btn" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>{editing ? t("Close") : ex ? t("Correct") : t("Enter manually")}</button>}
      </div>
      {promise && <p className="note note-info">{promise.status === "active"
        ? t("Promise confirmed: {amount} expected on {date}. Not a payment.", { amount: formatSen(inv.outstandingAmountSen), date: formatMytDate(promise.promisedDate, true) })
        : promise.status === "fulfilled" ? t("This payment promise has been fulfilled.") : t("This promise was replaced by a newer confirmed promise.")}</p>}
      {!promise && (editing || (reply.processingStatus !== "ready" && !ex)) && <CorrectReply key={reply.version} reply={reply} onDone={() => setEditing(false)} />}
      {!promise && ex?.intent === "promise" && reply.processingStatus === "ready" && isOpen(inv) && <ConfirmPromise key={`${reply.version}:${inv.version}`} inv={inv} reply={reply} />}
    </li>
  );
}

const INTENT_LABEL: Record<ReplyIntent, string> = {
  paid: msg("Says paid"), promise: msg("Promises a date"), partial: msg("Partial payment"), dispute: msg("Dispute"), other: msg("Other / unclear"),
};

function AddReply({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  const t = useT();
  const { pushToast, mock, asOf } = useSession();
  const add = useAction("createReply");
  // Mock mode pre-fills the first fixture message so the demo request matches an approved fixture.
  const [text, setText] = useState(mock ? "Dah bayar boss, RM9,000." : "");
  const [receivedAt, setReceivedAt] = useState(asOf ? utcToMytLocalInput(mock ? "2026-10-23T03:30:00Z" : asOf) : "");
  const [language, setLanguage] = useState<Language>(mock ? "ms" : "en");
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    const utc = mytLocalInputToUtc(receivedAt);
    if (!text.trim() || text.length > 4000) { setErr(t("Message must be 1 to 4,000 characters.")); return; }
    if (!utc) { setErr(t("Enter when the message was received.")); return; }
    if (!asOf || Date.parse(utc) > Date.parse(asOf)) { setErr(t("Received time cannot be after the demo clock.")); return; }
    setErr(null);
    void add.run({ id: inv.id, body: { expectedVersion: inv.version, text, receivedAt: utc, language } }, t("Reply saved.")).then((res) => {
      // The reply is kept even when extraction fails; Finance enters the fields by hand.
      if (res) onClose();
      if (res?.data.fallbackReason) pushToast("info", t("Automatic extraction unavailable ({reason}). Enter the fields manually.", { reason: res.data.fallbackReason }));
    });
  };
  return (
    <div className="composer">
      <h3>{t("Add a customer reply")}</h3>
      {add.error && <ErrorNote error={add.error} onRetry={submit} onDismiss={add.clearError} />}
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label={t("Message text (pasted from WhatsApp or email)")} error={err}>
          {(id) => <textarea id={id} rows={3} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
        <div className="row gap wrap">
          <Field label={t("Received at (MYT)")} hint={t("Used to read relative dates like 'Friday'.")}>
            {(id) => <input id={id} type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />}
          </Field>
          <Field label={t("Message language")}>
            {(id) => (
              <select id={id} value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
                <option value="ms">{t("Bahasa Melayu")}</option><option value="en">{t("English")}</option><option value="zh">{t("Chinese")}</option>
              </select>
            )}
          </Field>
        </div>
        <div className="row gap wrap">
          <button className="btn btn-primary" type="submit" disabled={!add.roleAllowed || !add.supported || add.pending}>{add.pending ? t("Saving and extracting…") : t("Save reply")}</button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>{t("Cancel")}</button>
          <ActionHint {...add} />
        </div>
      </form>
    </div>
  );
}

function CorrectReply({ reply, onDone }: { reply: Reply; onDone: () => void }) {
  const t = useT();
  const fix = useAction("correctReply");
  const ex = reply.extraction;
  const [intent, setIntent] = useState<ReplyIntent>(ex?.intent ?? "paid");
  const [amount, setAmount] = useState(senToInput(ex?.amountSen ?? null));
  const [date, setDate] = useState(ex?.promisedDate ?? "");
  const [reason, setReason] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const submit = () => {
    const e: Record<string, string> = {};
    const sen = amount.trim() ? parseRinggitToSen(amount) : null;
    if (amount.trim() && (sen === null || sen <= 0)) e.amount = t("Enter a positive amount like 9000 or 9,000.00.");
    if (intent === "promise" && !date) e.date = t("A promise needs a date.");
    if (!reason.trim()) e.reason = t("Say why you corrected it.");
    setErrs(e);
    if (Object.keys(e).length) return;
    void fix.run({ id: reply.id, body: { expectedVersion: reply.version, intent, promisedDate: date || null, amountSen: sen, reason: reason.trim() } }, t("Reply fields corrected and stamped as manual review."))
      .then((r) => { if (r) onDone(); });
  };
  return (
    <form className="subform" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {fix.error && <ErrorNote error={fix.error} onRetry={submit} onDismiss={fix.clearError} />}
      <div className="row gap wrap">
        <Field label={t("Intent")}>{(id) => (
          <select id={id} value={intent} onChange={(e) => setIntent(e.target.value as ReplyIntent)}>
            {(Object.keys(INTENT_LABEL) as ReplyIntent[]).map((k) => <option key={k} value={k}>{t(INTENT_LABEL[k])}</option>)}
          </select>)}
        </Field>
        <Field label={t("Amount (RM)")} error={errs.amount}>{(id) => <input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="9,000.00" />}</Field>
        <Field label={t("Promised date (MYT)")} error={errs.date}>{(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      </div>
      <Field label={t("Reason for correction")} error={errs.reason}>{(id) => <input id={id} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={t("Finance reviewed the original message.")} />}</Field>
      <div className="row gap wrap">
        <button className="btn btn-primary" type="submit" disabled={!fix.roleAllowed || !fix.supported || fix.pending}>{fix.pending ? t("Saving…") : t("Save correction")}</button>
        <ActionHint {...fix} />
      </div>
      <p className="muted tiny">{t("The server stamps who reviewed it. A correction never creates a payment.")}</p>
    </form>
  );
}

function ConfirmPromise({ inv, reply }: { inv: Invoice; reply: Reply }) {
  const t = useT();
  const confirm = useAction("confirmPromise");
  const ex = reply.extraction!;
  const date = ex.promisedDate ?? "";
  const sen = ex.amountSen;
  const differs = sen !== inv.outstandingAmountSen;
  const valid = Boolean(date) && sen !== null && sen > 0 && !differs;
  const submit = () => {
    if (!valid) return;
    void confirm.run({ id: reply.id, body: { expectedVersion: reply.version, expectedInvoiceVersion: inv.version, promisedDate: date, amountSen: sen } }, t("Promise confirmed. Forecast now expects the balance on that date."));
  };
  return (
    <div className="confirm-box">
      <h3>{t("Confirm payment promise")}</h3>
      <p className="small">{t("Read from the message received {time}. Dates are Malaysia calendar dates. Confirming only moves the expected date in the cash forecast. It is not a payment and does not change the original due date ({due}).", { time: formatUtcAsMyt(reply.receivedAt), due: formatMytDate(inv.dueDate) })}</p>
      <p className="muted small">{t("These are the reviewed reply fields. Use Correct above to change a date or amount before confirming.")}</p>
      {confirm.error && <ErrorNote error={confirm.error} onRetry={submit} onDismiss={confirm.clearError} />}
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="row gap wrap">
          <Field label={t("Promised date (MYT)")}>{(id) => <input id={id} type="date" value={date} readOnly />}</Field>
          <Field label={t("Amount (RM)")} hint={t("Must be the whole outstanding balance: {amount}", { amount: formatSen(inv.outstandingAmountSen) })} error={differs ? t("Differs from the outstanding balance. The server will ask for review.") : null}>
            {(id) => <input id={id} inputMode="decimal" value={senToInput(sen)} readOnly />}
          </Field>
        </div>
        <div className="row gap wrap">
          <button type="submit" className="btn btn-primary" disabled={!confirm.roleAllowed || !confirm.supported || confirm.pending || !valid}>
            {confirm.pending ? t("Confirming…") : t("Confirm {date} for {amount}", { date: date ? formatMytDate(date) : "—", amount: sen !== null ? formatSen(sen) : "—" })}
          </button>
          <ActionHint {...confirm} />
        </div>
      </form>
    </div>
  );
}

