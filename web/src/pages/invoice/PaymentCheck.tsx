import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAction, useSession } from "../../lib/session";
import { ClientError } from "../../lib/client/types";
import type { BankCredit, Invoice, MatchResult, Receipt, Workspace } from "../../lib/contract";
import { formatMytDate, formatSen, formatUtcAsMyt, mytDateOf, mytLocalInputToUtc, parseRinggitToSen, senToInput, utcToMytLocalInput } from "../../lib/format";
import { byId, isOpen, latestMatchForReceipt, userName } from "../../lib/selectors";
import { href } from "../../lib/route";
import { ActionHint, Badge, ErrorNote, Field, KeyValue, Loading, Money, PROCESSING, REASON_TEXT, VERDICT } from "../../components/ui";
import { msg, useT } from "../../i18n";

type StepState = "done" | "current" | "blocked" | "todo";

function Step({ n, title, state, summary, open, onToggle, children }: {
  n: number; title: string; state: StepState; summary?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  const t = useT();
  const stateText = { done: t("Done"), current: t("Next"), blocked: t("Needs attention"), todo: t("Not yet") }[state];
  return (
    <li className={`step step-${state}`}>
      <button className="step-head" onClick={onToggle} aria-expanded={open} disabled={state === "todo"}>
        <span className="step-n" aria-hidden="true">{state === "done" ? "✓" : n}</span>
        <span className="step-title">{title}</span>
        <span className="step-state">{stateText}</span>
      </button>
      {!open && summary && <div className="step-summary">{summary}</div>}
      {open && <div className="step-body">{children}</div>}
    </li>
  );
}

/**
 * Checking one payment: screenshot, bank check, Finance records it.
 * Every verdict and amount shown here comes from the server; this page only lays it out.
 */
export function PaymentTab({ ws, inv }: { ws: Workspace; inv: Invoice }) {
  const t = useT();
  const receipts = ws.receipts.filter((r) => r.invoiceId === inv.id);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const latest = byId(receipts, selectedReceiptId) ?? receipts[receipts.length - 1];
  const match = latest ? latestMatchForReceipt(ws, latest.id) : undefined;
  const applied = match?.status === "applied";
  const [newRound, setNewRound] = useState(false);
  const useLatest = latest && !newRound;

  const okVerdict = match && (match.verdict === "confirmed" || match.verdict === "partial");
  const s1: StepState = useLatest ? (latest.processingStatus === "ready" ? "done" : "blocked") : "current";
  const s2: StepState = !useLatest || s1 !== "done" ? "todo" : !match ? "current" : okVerdict || applied ? "done" : "blocked";
  const s3: StepState = s2 !== "done" ? "todo" : applied ? "done" : "current";
  const firstOpen = [s1, s2, s3].findIndex((s) => s === "current" || s === "blocked");
  const [openStep, setOpenStep] = useState<number | null>(null);
  const isOpenStep = (i: number) => (openStep === null ? firstOpen === i : openStep === i);
  const toggle = (i: number) => setOpenStep(isOpenStep(i) ? -1 : i);
  const payment = match ? ws.payments.find((p) => p.matchResultId === match.id) : undefined;

  return (
    <div className="tab-body">
      <p className="summary-line">
        {t("Received {paid} of {total}.", { paid: formatSen(inv.paidAmountSen), total: formatSen(inv.totalAmountSen) })}{" "}
        {inv.outstandingAmountSen > 0 ? <b>{t("{amount} still due.", { amount: formatSen(inv.outstandingAmountSen) })}</b> : <b>{t("Fully paid.")}</b>}
      </p>
      <p className="muted small">{t("A screenshot or a message is not money. A payment counts only after it matches a bank credit and Finance records it.")}</p>

      {receipts.length > 1 && !newRound && <Field label={t("Screenshot to review")}>
        {(id) => <select id={id} value={latest?.id ?? ""} onChange={(e) => { setSelectedReceiptId(e.target.value); setOpenStep(null); }}>
          {receipts.map((r, index) => <option key={r.id} value={r.id}>{index + 1}. {r.evidence?.reference ?? r.id} · {formatSen(r.evidence?.amountSen)}</option>)}
        </select>}
      </Field>}
      {latest && isOpen(inv) && !newRound && (
        <div className="row gap wrap"><button className="btn" onClick={() => { setNewRound(true); setOpenStep(null); }}>{t("Check another payment")}</button></div>
      )}

      <ol className="steps-v">
        <Step n={1} title={t("Payment screenshot")} state={s1} open={isOpenStep(0)} onToggle={() => toggle(0)}
          summary={useLatest && latest.evidence ? `${formatSen(latest.evidence.amountSen)} · ${latest.evidence.reference ?? "—"} · ${latest.evidence.payer ?? "—"}` : undefined}>
          {useLatest ? <ReceiptFields key={latest.id} ws={ws} receipt={latest} /> : isOpen(inv) ? <UploadReceipt ws={ws} inv={inv} onDone={(id) => { setSelectedReceiptId(id); setNewRound(false); setOpenStep(null); }} /> : <p className="muted">{t("This invoice is not open for payment.")}</p>}
        </Step>
        <Step n={2} title={t("Bank check")} state={s2} open={isOpenStep(1)} onToggle={() => toggle(1)}
          summary={match ? <Badge tone={VERDICT[match.verdict].tone}>{t(VERDICT[match.verdict].label)}</Badge> : undefined}>
          {useLatest && <BankCheck ws={ws} inv={inv} receipt={latest} match={match} />}
        </Step>
        <Step n={3} title={t("Finance records the payment")} state={s3} open={isOpenStep(2)} onToggle={() => toggle(2)}
          summary={payment ? t("{amount} recorded on {time}", { amount: formatSen(payment.amountSen), time: formatUtcAsMyt(payment.confirmedAt) }) : undefined}>
          {match && okVerdict && !applied && <FinanceConfirm key={match.id} inv={inv} receipt={latest} match={match} credit={byId(ws.bankCredits, match.eligibleCreditId)} ledgerVersion={ws.company.version} />}
          {payment && <p className="note note-success">{t("{amount} recorded on {time}. This bank credit cannot be used again.", { amount: formatSen(payment.amountSen), time: formatUtcAsMyt(payment.confirmedAt) })}</p>}
        </Step>
      </ol>

      {receipts.length > 1 && (
        <details className="others">
          <summary>{t("Earlier screenshots ({n})", { n: receipts.length - 1 })}</summary>
          <ul className="rows">
            {receipts.slice(0, -1).map((r) => (
              <li key={r.id}><div className="row-main"><span>{r.evidence?.reference ?? r.id}</span><Money sen={r.evidence?.amountSen} /></div></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ReceiptFields({ ws, receipt }: { ws: Workspace; receipt: Receipt }) {
  const t = useT();
  const { users } = useSession();
  const [editing, setEditing] = useState(receipt.processingStatus !== "ready");
  const ev = receipt.evidence;
  const p = PROCESSING[receipt.processingStatus];
  return (
    <>
      {receipt.processingStatus !== "ready" && <p className="note note-warning">{t(p.hint)}</p>}
      <div className="evidence">
        <ReceiptImage receipt={receipt} />
        {ev ? (
          <KeyValue items={[
            [t("Amount"), <Money sen={ev.amountSen} strong />],
            [t("Reference"), ev.reference ?? "—"],
            [t("Payer"), ev.payer ?? "—"],
            [t("Transferred"), formatUtcAsMyt(ev.transferredAt)],
            [t("Sending bank"), ev.bank ?? "—"],
            [t("Read by"), ev.source === "ai"
              ? (ev.confidence !== null ? t("AI confidence: {n}%", { n: Math.round(ev.confidence * 100) }) : t("AI"))
              : t("{name}, {time}", { name: userName(ws, ev.reviewedBy, users), time: formatUtcAsMyt(ev.reviewedAt) })],
          ]} />
        ) : <p className="muted">{t("No fields yet. Enter them below.")}</p>}
      </div>
      {!ws.payments.some((p) => p.receiptId === receipt.id) && <>
        <button className="link-btn" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>{editing ? t("Close") : t("Correct these fields")}</button>
        {editing && <CorrectReceipt key={receipt.version} receipt={receipt} onDone={() => setEditing(false)} />}
      </>}
    </>
  );
}

function ReceiptImage({ receipt }: { receipt: Receipt }) {
  const t = useT();
  const { client, actor, source, revision, isCurrentSession } = useSession();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<ClientError | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setUrl(null); setError(null);
    if (!actor || source === "mock") return;
    let disposed = false;
    let blobUrl: string | null = null;
    client.request("getReceiptImage", { actorId: actor.id, id: receipt.id }).then((res) => {
      if (disposed || !isCurrentSession(actor.id, revision)) return;
      blobUrl = URL.createObjectURL(res.body);
      setUrl(blobUrl);
    }).catch((e: unknown) => {
      if (disposed || !isCurrentSession(actor.id, revision)) return;
      setError(e instanceof ClientError ? e : new ClientError({ kind: "bad_response", message: String(e) }));
    });
    return () => { disposed = true; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [actor, client, receipt.id, revision, isCurrentSession, source, attempt]);
  return <div className="image-slot">
    {url ? <a href={url} target="_blank" rel="noreferrer"><img className="receipt-original" src={url} alt={t("Original screenshot")} /></a>
      : source === "mock" ? <p>{t("Mock fixture: original image is unavailable.")}</p>
      : error ? <ErrorNote error={error} read onRetry={() => setAttempt((n) => n + 1)} />
      : <Loading label={t("Loading screenshot…")} />}
  </div>;
}

function BankCheck({ ws, inv, receipt, match }: { ws: Workspace; inv: Invoice; receipt: Receipt; match?: MatchResult }) {
  const t = useT();
  const run = useAction("runMatch");
  const runCheck = () => run.run({ id: receipt.id, body: { expectedVersion: receipt.version, expectedInvoiceVersion: inv.version } }, t("Bank check finished."));
  const credits = match ? match.candidateCreditIds.map((id) => byId(ws.bankCredits, id)).filter((c): c is BankCredit => Boolean(c)) : [];
  const v = match ? VERDICT[match.verdict] : null;
  const ok = match && (match.verdict === "confirmed" || match.verdict === "partial");
  return (
    <>
      {match && v && (
        <div className={`verdict tone-${v.tone}`}>
          <Badge tone={v.tone}>{t(v.label)}</Badge>
          <p>{t(v.explain)}</p>
          {!ok && match.status === "pending" && <p><b>{t("Next step")}:</b> {t(nextStep(match))} {match.reasons.includes("no_bank_reference") && <a href={href("bank")}>{t("Open bank credits")}</a>}</p>}
        </div>
      )}
      {match && (
        <details className="more">
          <summary>{t("Show the comparison")}</summary>
          <MatchBody ws={ws} match={match} receipt={receipt} credits={credits} />
        </details>
      )}
      {isOpen(inv) && match?.status !== "applied" && (
        <div className="row gap wrap">
          <button className={`btn ${match ? "" : "btn-primary"}`} disabled={!run.roleAllowed || !run.supported || run.pending || !receipt.evidence} onClick={() => void runCheck()}>
            {run.pending ? t("Checking bank data…") : match ? t("Run the check again") : t("Run bank check")}
          </button>
          <ActionHint {...run} extra={!receipt.evidence ? msg("Enter the screenshot fields first") : null} />
        </div>
      )}
      {run.error && <ErrorNote error={run.error} onRetry={() => void runCheck()} onDismiss={run.clearError} />}
    </>
  );
}

const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

function UploadReceipt({ ws, inv, onDone }: { ws: Workspace; inv: Invoice; onDone?: (id: string) => void }) {
  const t = useT();
  const { mock } = useSession();
  const up = useAction("uploadReceipt");
  const [file, setFile] = useState<File | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const linkable = ws.replies.filter((r) => r.invoiceId === inv.id && !r.receiptId);
  // null means "pick the newest unlinked reply"; "" means the person chose not to link.
  const [chosenReply, setReplyId] = useState<string | null>(null);
  const replyId = chosenReply ?? linkable[linkable.length - 1]?.id ?? "";
  const preview = useMemo(() => (file && file.size > 0 && !mock ? URL.createObjectURL(file) : null), [file, mock]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = (f: File | null) => {
    setFile(f);
    if (!f) { setFileErr(null); return; }
    // Quick pre-checks for a helpful message; the server checks the real bytes again.
    if (!ACCEPTED.includes(f.type)) setFileErr(t("Use a PNG, JPEG or WebP image."));
    else if (f.size > MAX_BYTES) setFileErr(t("Image is larger than 5 MiB."));
    else setFileErr(null);
  };
  const submit = () => {
    if (!file || fileErr) return;
    const reply = byId(ws.replies, replyId);
    const fields: Record<string, string> = { expectedVersion: String(inv.version) };
    if (reply) { fields.replyId = reply.id; fields.expectedReplyVersion = String(reply.version); }
    void up.run({ id: inv.id, multipart: { fields, file } }, t("Screenshot uploaded. Check the fields, then run the bank check.")).then((r) => { if (r) onDone?.(r.data.receipt.id); });
  };

  return (
    <div>
      {up.error && <ErrorNote error={up.error} onRetry={submit} onDismiss={up.clearError} />}
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label={t("Screenshot (PNG, JPEG or WebP, up to 5 MiB)")} error={fileErr}>
          {(id) => <input id={id} type="file" accept={ACCEPTED.join(",")} onChange={(e) => pick(e.target.files?.[0] ?? null)} />}
        </Field>
        {mock && (
          <p className="small">
            <button type="button" className="btn btn-small btn-ghost" onClick={() => pick(mock.fixtureFile("image_demo_partial", "synthetic-partial.png", "image/png"))}>{t("Use the synthetic fixture screenshot")}</button>
            <span className="muted tiny"> {t("Fixture image bytes are not generated yet (planned).")}</span>
          </p>
        )}
        {file && <p className="small">{t("Selected")}: <b>{file.name}</b></p>}
        {preview && <img className="thumb" src={preview} alt={t("Selected screenshot preview, not uploaded yet")} />}
        {linkable.length > 0 && (
          <Field label={t("Link to reply (optional)")}>
            {(id) => (
              <select id={id} value={replyId} onChange={(e) => setReplyId(e.target.value)}>
                <option value="">{t("Do not link")}</option>
                {linkable.map((r) => <option key={r.id} value={r.id}>"{r.text.slice(0, 40)}" · {formatUtcAsMyt(r.receivedAt)}</option>)}
              </select>
            )}
          </Field>
        )}
        <div className="row gap wrap">
          <button className="btn btn-primary" type="submit" disabled={!file || Boolean(fileErr) || !up.roleAllowed || !up.supported || up.pending}>{up.pending ? t("Uploading and reading…") : t("Upload and read")}</button>
          <ActionHint {...up} />
        </div>
      </form>
    </div>
  );
}

function CorrectReceipt({ receipt, onDone }: { receipt: Receipt; onDone: () => void }) {
  const t = useT();
  const fix = useAction("correctReceipt");
  const ev = receipt.evidence;
  const [v, setV] = useState({
    bank: ev?.bank ?? "", amount: senToInput(ev?.amountSen ?? null), reference: ev?.reference ?? "",
    transferredAt: ev?.transferredAt ? utcToMytLocalInput(ev.transferredAt) : "", payer: ev?.payer ?? "", reason: "",
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const submit = () => {
    const e: Record<string, string> = {};
    const sen = parseRinggitToSen(v.amount);
    const utc = mytLocalInputToUtc(v.transferredAt);
    if (sen === null || sen <= 0) e.amount = t("Enter a positive amount like 9000 or 9,000.00.");
    if (!utc) e.transferredAt = t("Enter the transfer time.");
    for (const k of ["bank", "reference", "payer", "reason"] as const) if (!v[k].trim()) e[k] = t("Required.");
    setErrs(e);
    if (Object.keys(e).length) return;
    void fix.run({ id: receipt.id, body: { expectedVersion: receipt.version, bank: v.bank.trim(), amountSen: sen, reference: v.reference.trim(), transferredAt: utc, payer: v.payer.trim(), reason: v.reason.trim() } },
      t("Screenshot fields corrected. Run the bank check again.")).then((r) => { if (r) onDone(); });
  };
  return (
    <form className="subform" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {fix.error && <ErrorNote error={fix.error} onRetry={submit} onDismiss={fix.clearError} />}
      <div className="form-grid">
        <Field label={t("Amount (RM)")} error={errs.amount}>{(id) => <input id={id} inputMode="decimal" value={v.amount} onChange={set("amount")} />}</Field>
        <Field label={t("Reference")} error={errs.reference}>{(id) => <input id={id} value={v.reference} onChange={set("reference")} />}</Field>
        <Field label={t("Payer name")} error={errs.payer}>{(id) => <input id={id} value={v.payer} onChange={set("payer")} />}</Field>
        <Field label={t("Transferred at (MYT)")} error={errs.transferredAt}>{(id) => <input id={id} type="datetime-local" value={v.transferredAt} onChange={set("transferredAt")} />}</Field>
        <Field label={t("Sending bank")} error={errs.bank}>{(id) => <input id={id} value={v.bank} onChange={set("bank")} />}</Field>
        <Field label={t("Reason for correction")} error={errs.reason}>{(id) => <input id={id} value={v.reason} maxLength={500} onChange={set("reason")} placeholder={t("Finance checked the original screenshot.")} />}</Field>
      </div>
      <div className="row gap wrap">
        <button className="btn btn-primary" type="submit" disabled={!fix.roleAllowed || !fix.supported || fix.pending}>{fix.pending ? t("Saving…") : t("Save correction")}</button>
        <ActionHint {...fix} />
      </div>
      <p className="muted tiny">{t("Corrections are stamped by the server and must go through the bank check again.")}</p>
    </form>
  );
}

function nextStep(m: MatchResult): string {
  const r = new Set(m.reasons);
  if (r.has("low_confidence") || r.has("missing_field") || r.has("invalid_evidence") || r.has("manual_review_required")) return msg("check and correct the screenshot fields, then run the check again.");
  if (r.has("no_bank_reference")) return msg("import the latest bank statement, then run the check again. The customer may still have paid.");
  if (r.has("amount_differs")) return msg("compare the screenshot with the bank record. If the screenshot was misread, correct it; otherwise ask the customer.");
  if (r.has("multiple_candidates")) return msg("two bank credits share this reference. Resolve the bank data before any payment.");
  if (r.has("credit_already_allocated") || r.has("reused_reference") || r.has("duplicate_image")) return msg("this evidence was already used. Ask the customer for a new proof of the remaining payment.");
  if (r.has("wrong_payer")) return msg("the payer is not registered for this customer. Confirm who paid.");
  if (r.has("overpayment")) return msg("the credit is more than the balance. Handle it manually.");
  return msg("review the reasons above.");
}

function MatchBody({ ws, match, receipt, credits }: { ws: Workspace; match: MatchResult; receipt: Receipt; credits: BankCredit[] }) {
  const t = useT();
  const ev = receipt.evidence;
  const customer = byId(ws.customers, byId(ws.invoices, match.invoiceId)?.customerId);
  return (
    <>
      <ul className="reasons">
        {match.reasons.map((r) => <li key={r}><code>{r}</code> {REASON_TEXT[r] ? t(REASON_TEXT[r]) : ""}</li>)}
      </ul>
      {credits.length === 0 ? (
        <p className="muted small">{t("No bank credit in the imported data matches this reference.")}</p>
      ) : (
        <div className="table-wrap">
          <table className="table compare">
            <caption className="sr-only">{t("Screenshot fields compared with bank credits")}</caption>
            <thead>
              <tr><th>{t("Field")}</th><th>{t("Screenshot")}</th>{credits.map((c) => <th key={c.id}>{t("Bank credit")} {c.externalId}{c.id === match.eligibleCreditId ? ` (${t("eligible")})` : ""}</th>)}</tr>
            </thead>
            <tbody>
              <tr><th scope="row">{t("Amount")}</th><td><Money sen={ev?.amountSen} /></td>{credits.map((c) => <td key={c.id}><Money sen={c.amountSen} /> <Same a={ev?.amountSen} b={c.amountSen} /></td>)}</tr>
              <tr><th scope="row">{t("Reference")}</th><td>{ev?.reference}</td>{credits.map((c) => <td key={c.id}>{c.reference}</td>)}</tr>
              <tr><th scope="row">{t("Payer")}</th><td>{ev?.payer}</td>{credits.map((c) => <td key={c.id}>{c.payer}</td>)}</tr>
              <tr><th scope="row">{t("Date (MYT)")}</th><td>{ev?.transferredAt ? formatMytDate(mytDateOf(ev.transferredAt)) : "—"}</td>{credits.map((c) => <td key={c.id}>{t("Posted {date}", { date: formatMytDate(c.postedDate) })}</td>)}</tr>
              <tr><th scope="row">{t("Allocation")}</th><td>—</td>{credits.map((c) => <td key={c.id}>{c.allocatedPaymentId ? <Badge tone="danger">{t("Already allocated")}</Badge> : <Badge>{t("Unallocated")}</Badge>}</td>)}</tr>
            </tbody>
          </table>
        </div>
      )}
      {customer && <p className="muted tiny">{t("Registered payer names for {name}", { name: customer.name })}: {customer.payerAliases.join(", ")}</p>}
    </>
  );
}

function Same({ a, b }: { a: number | null | undefined; b: number }) {
  const t = useT();
  if (a === null || a === undefined) return null;
  return a === b ? <span className="same">{t("same")}</span> : <span className="diff">{t("differs")}</span>;
}

function FinanceConfirm({ inv, receipt, match, credit, ledgerVersion }: { inv: Invoice; receipt: Receipt; match: MatchResult; credit?: BankCredit; ledgerVersion: number }) {
  const t = useT();
  const approve = useAction("approvePayment");
  const [checked, setChecked] = useState(false);
  const stale = match.invoiceVersion !== inv.version || match.receiptVersion !== receipt.version || match.bankLedgerVersion !== ledgerVersion || !credit || match.eligibleCreditVersion !== credit.version || Boolean(credit.allocatedPaymentId);
  useEffect(() => setChecked(false), [inv.version, receipt.version, ledgerVersion, credit?.version]);
  const partial = match.verdict === "partial";
  const amount = match.proposedPaymentAmountSen;
  const after = match.proposedOutstandingAmountSen;
  const submit = () => {
    if (!checked || stale) return;
    return approve.run({ id: match.id, body: { expectedVersion: match.version } },
      partial ? t("Partial payment of {amount} recorded. {after} is still outstanding.", { amount: formatSen(amount), after: formatSen(after) }) : t("Payment of {amount} recorded.", { amount: formatSen(amount) }));
  };

  return (
    <div className="confirm-plain">
      <p className="small muted">{t("Nothing is recorded until you confirm. The amounts come from the server check, not from this page.")}</p>
      <div className="ledger">
        <div><span>{t("Outstanding now")}</span><Money sen={inv.outstandingAmountSen} /></div>
        <div><span>{t("This payment (bank credit {id}, posted {date})", { id: credit?.externalId ?? "—", date: credit ? formatMytDate(credit.postedDate) : "—" })}</span><span className="money">{amount !== null ? `− ${formatSen(amount)}` : "—"}</span></div>
        <div className="ledger-total"><span>{t("Outstanding after recording")}</span><Money sen={after} strong /></div>
      </div>
      {partial
        ? <p className="note note-warning">{t("This is a partial payment. The invoice will stay open with {after} due, and collection continues.", { after: formatSen(after) })}</p>
        : <p className="note note-info">{t("This covers the whole balance. The server decides if the invoice is then paid and collection stops.")}</p>}
      {stale && <p className="note note-error" role="alert">{t("The invoice, screenshot or bank ledger changed. Run the bank check again before recording.")}</p>}
      {approve.error && <ErrorNote error={approve.error} onRetry={() => void submit()} onDismiss={approve.clearError} />}
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        {t("I checked the bank credit, the screenshot and the amounts above.")}
      </label>
      <div className="row gap wrap">
        <button className="btn btn-primary" disabled={!checked || stale || !approve.roleAllowed || !approve.supported || approve.pending} onClick={() => void submit()}>
          {approve.pending ? t("Recording…") : partial ? t("Record partial payment of {amount}", { amount: formatSen(amount) }) : t("Record payment of {amount}", { amount: formatSen(amount) })}
        </button>
        <ActionHint {...approve} />
      </div>
    </div>
  );
}
