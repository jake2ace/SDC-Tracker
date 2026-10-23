import { useState } from "react";
import { useAction, useSession } from "../lib/session";
import type { BankImportResult } from "../lib/contract";
import { formatMytDate } from "../lib/format";
import { byId } from "../lib/selectors";
import { href } from "../lib/route";
import { ActionHint, Badge, Empty, ErrorNote, Field, Money, Panel } from "../components/ui";
import { useT } from "../i18n";

const HEADER = "externalId,postedDate,amountSen,reference,payer,bank";

export function BankPage() {
  const t = useT();
  const { workspace: ws } = useSession();
  const [importing, setImporting] = useState(false);
  if (!ws) return null;

  return (
    <>
      <header className="page-head">
        <h1>{t("Bank")}</h1>
        <p className="muted">{t("Money that arrived in the bank account, from an imported statement. Used to check payment screenshots.")}</p>
      </header>
      <div className="row gap wrap">
        {!importing && <button className="btn btn-primary" onClick={() => setImporting(true)}>{t("Import bank statement")}</button>}
      </div>
      {importing && <ImportBox onClose={() => setImporting(false)} />}

      <Panel title={t("Bank credits")}>
        {ws.bankCredits.length === 0 ? <Empty title={t("No bank credits yet")}>{t("Import a statement to start checking payments.")}</Empty> : (
          <ul className="rows">
            {ws.bankCredits.map((c) => {
              const pay = byId(ws.payments, c.allocatedPaymentId);
              const inv = pay ? byId(ws.invoices, pay.invoiceId) : undefined;
              return (
                <li key={c.id}>
                  <div className="row-main">
                    <div>
                      <div>{c.payer}</div>
                      <div className="muted small">{formatMytDate(c.postedDate)} · {t("Ref")} {c.reference}</div>
                    </div>
                    <Money sen={c.amountSen} strong />
                  </div>
                  <div className="row gap">
                    {c.allocatedPaymentId
                      ? <><Badge tone="success">{t("Used for a payment")}</Badge>{inv && <a className="small" href={href("invoices", inv.id, "payment")}>{inv.number}</a>}</>
                      : <Badge>{t("Not used yet")}</Badge>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}

function ImportBox({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { workspace: ws, mock } = useSession();
  const imp = useAction("importBankStatement");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ rows: string[][]; headerOk: boolean } | null>(null);
  const [result, setResult] = useState<BankImportResult | null>(null);
  if (!ws) return null;

  const pick = async (f: File | null) => {
    setFile(f); setResult(null); imp.clearError();
    if (!f) { setPreview(null); return; }
    const text = (await f.text()).replace(/^﻿/, "");
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    // Preview only. Checks, duplicates and the import itself happen on the server.
    setPreview({ headerOk: lines[0] === HEADER, rows: lines.slice(1, 6).map((l) => l.split(",")) });
  };
  const submit = async () => {
    if (!file) return;
    const res = await imp.run({ multipart: { fields: { expectedVersion: String(ws.company.version) }, file } });
    if (res) setResult(res.data);
  };

  return (
    <Panel title={t("Import bank statement")} className="callout" actions={<button className="btn btn-ghost btn-small" onClick={onClose}>{t("Close")}</button>}>
      {imp.error && <ErrorNote error={imp.error} onRetry={() => void submit()} onDismiss={imp.clearError} />}
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label={t("CSV file")} hint={<>{t("Columns")}: <code>{HEADER}</code></>}>
          {(id) => <input id={id} type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0] ?? null)} />}
        </Field>
        {mock && (
          <div className="row gap wrap small">
            <span className="muted">{t("Try a sample file")}:</span>
            {mock.textFixtures().map((x) => (
              <button key={x.id} type="button" className="link-btn" onClick={() => void pick(new File([x.text], `${x.id}.csv`, { type: "text/csv" }))}>{x.id}</button>
            ))}
          </div>
        )}
        {preview && (
          <>
            {!preview.headerOk && <p className="note note-warning">{t("The columns do not match. The server will reject this file.")}</p>}
            <div className="table-wrap">
              <table className="table">
                <thead><tr>{HEADER.split(",").map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{preview.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} data-label={HEADER.split(",")[j]}>{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </>
        )}
        <div className="row gap wrap">
          <button className="btn btn-primary" type="submit" disabled={!file || !imp.roleAllowed || !imp.supported || imp.pending}>{imp.pending ? t("Importing…") : t("Import")}</button>
          <ActionHint {...imp} />
        </div>
      </form>
      {result && (
        <div className="note note-info" role="status">
          {t("{n} new, {d} already imported. No payment was recorded.", { n: result.insertedCount, d: result.duplicateCount })}
          {result.duplicates.length > 0 && (
            <ul>{result.duplicates.map((d) => (
              <li key={d.rowNumber}>{t("Row {row} is the same record as {id}", { row: d.rowNumber, id: byId(ws.bankCredits, d.existingCreditId)?.externalId ?? d.existingCreditId })}</li>
            ))}</ul>
          )}
        </div>
      )}
    </Panel>
  );
}
