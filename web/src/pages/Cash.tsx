import { useEffect, useRef, useState } from "react";
import { useSession } from "../lib/session";
import type { Forecast, ForecastDay, ForecastScenario, Workspace } from "../lib/contract";
import { ClientError } from "../lib/client/types";
import { formatMytDate, formatSen, shortMytDate } from "../lib/format";
import { byId } from "../lib/selectors";
import { href } from "../lib/route";
import { Badge, Empty, ErrorNote, Loading, Money, Panel } from "../components/ui";
import { GlassPuck, useGlassPuck } from "../components/Glass";
import { useT } from "../i18n";

export function CashPage() {
  const t = useT();
  const { workspace: ws, client, actor, dataVersion, revision, isCurrentSession } = useSession();
  const [delay, setDelay] = useState(ws?.forecastDefaults.delayDays ?? 7);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [error, setError] = useState<ClientError | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  useEffect(() => {
    if (!ws || !actor) return;
    const mine = ++seq.current;
    const current = () => mine === seq.current && isCurrentSession(actor.id, revision);
    setLoading(true);
    setForecast(null);
    setError(null);
    client.request("getForecast", { actorId: actor.id, query: { asOfDate: ws.forecastDefaults.asOfDate, delayDays: String(delay) } })
      .then((res) => {
        if (!current()) return;
        if (res.data.companyId !== ws.company.id) throw new ClientError({ kind: "bad_response", message: "Forecast belongs to another company." });
        setForecast(res.data); setError(null);
      })
      .catch((e: unknown) => { if (current()) { setForecast(null); setError(e instanceof ClientError ? e : new ClientError({ kind: "bad_response", message: String(e) })); } })
      .finally(() => { if (current()) setLoading(false); });
    return () => { seq.current += 1; };
  }, [ws, actor, client, delay, dataVersion, revision, isCurrentSession]);

  if (!ws) return null;
  return (
    <>
      <header className="page-head">
        <h1>{t("Cash")}</h1>
        <p className="muted">{t("Next 30 days from {date}. A forecast, not your bank balance.", { date: formatMytDate(ws.forecastDefaults.asOfDate) })}</p>
      </header>
      <div className="row gap wrap align-center">
        <label className="inline-field">
          {t("Late payment scenario")}{" "}
          <select value={delay} onChange={(e) => setDelay(Number(e.target.value))}>
            {[0, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{t("{n} days late", { n: d })}</option>)}
          </select>
        </label>
        {loading && <Loading label={t("Loading forecast…")} />}
      </div>
      {error && <ErrorNote error={error} read />}
      {!error && forecast && <ForecastView ws={ws} f={forecast} />}
    </>
  );
}

function ForecastView({ ws, f }: { ws: Workspace; f: Forecast }) {
  const t = useT();
  const [view, setView] = useState<"moves" | "days">("moves");
  const [focus, setFocus] = useState<ForecastScenario["kind"]>("delayed");
  const scenario = f.scenarios.find((s) => s.kind === focus)!;
  const tabRef = useRef<HTMLElement>(null);
  const puck = useGlassPuck(tabRef, view);
  const name = (s: ForecastScenario) => (s.kind === "on_time" ? t("Paid on time") : t("Paid {n} days late", { n: s.delayDays }));
  return (
    <>
      <div className="stats">
        {f.scenarios.map((s) => {
          const low = lowest(s.days);
          const below = s.days.filter((d) => d.belowSafetyThreshold).length;
          return (
            <div className="stat" key={s.kind}>
              <span>{name(s)}: {t("lowest balance")}</span>
              <Money sen={low.closingBalanceSen} strong />
              <span className="small muted">{formatMytDate(low.date)}</span>
              {below > 0 ? <Badge tone="danger">{t("Below safety line for {n} days", { n: below })}</Badge> : <Badge tone="success">{t("Stays above safety line")}</Badge>}
            </div>
          );
        })}
        <div className="stat"><span>{t("Safety line")}</span><Money sen={f.safetyThresholdSen} strong /><span className="small muted">{t("Start balance")} {formatSen(f.openingBalanceSen)}</span></div>
      </div>
      <Panel>
        <Chart f={f} />
      </Panel>
      <Panel>
        <div className="row gap wrap between">
          <nav ref={tabRef} className="tabs tabs-inline glass-track" aria-label={t("Forecast detail")}>
            <GlassPuck style={puck} />
            <button aria-current={view === "moves" ? "page" : undefined} onClick={() => setView("moves")}>{t("Money in and out")}</button>
            <button aria-current={view === "days" ? "page" : undefined} onClick={() => setView("days")}>{t("Day by day")}</button>
          </nav>
          <select aria-label={t("Scenario")} value={focus} onChange={(e) => setFocus(e.target.value as ForecastScenario["kind"])}>
            {f.scenarios.map((s) => <option key={s.kind} value={s.kind}>{name(s)}</option>)}
          </select>
        </div>
        {view === "moves" ? <Sources ws={ws} s={scenario} /> : <Days s={scenario} />}
      </Panel>
    </>
  );
}

function lowest(days: ForecastDay[]): ForecastDay {
  return days.reduce((a, b) => (b.closingBalanceSen < a.closingBalanceSen ? b : a), days[0]);
}

function Sources({ ws, s }: { ws: Workspace; s: ForecastScenario }) {
  const t = useT();
  const label = { actual_payment: t("Received"), expected_receipt: t("Expected, not received"), expense: t("Expense") } as const;
  const tone = { actual_payment: "success", expected_receipt: "pending", expense: "neutral" } as const;
  if (s.entries.length === 0) return <Empty title={t("No money moves in this window")} />;
  const sorted = s.entries.slice().sort((a, b) => a.date.localeCompare(b.date));
  return (
    <>
      <ul className="rows">
        {sorted.map((e) => {
          const inv = byId(ws.invoices, e.invoiceId);
          const exp = byId(ws.expenses, e.sourceId);
          const promise = inv ? ws.promises.find((p) => p.id === inv.confirmedPromiseId && p.status === "active") : undefined;
          return (
            <li key={e.id}>
              <div className="row-main">
                <div>
                  <div>{inv ? <a href={href("invoices", inv.id)}>{inv.number}</a> : exp?.title ?? e.sourceId}</div>
                  <div className="muted small">
                    {formatMytDate(e.date, true)}
                    {e.kind === "expected_receipt" ? ` · ${promise ? t("promised date") : t("due date")}${s.delayDays ? ` + ${t("{n} days", { n: s.delayDays })}` : ""}` : ""}
                  </div>
                </div>
                <div className="right"><Money sen={e.amountSen} signed strong /><Badge tone={tone[e.kind]}>{label[e.kind]}</Badge></div>
              </div>
            </li>
          );
        })}
      </ul>
      {s.deferredInvoiceIds.length > 0 && (
        <p className="note note-warning">{t("Pushed past 30 days and not counted: {list}", { list: s.deferredInvoiceIds.map((id) => byId(ws.invoices, id)?.number ?? id).join(", ") })}</p>
      )}
    </>
  );
}

function Days({ s }: { s: ForecastScenario }) {
  const t = useT();
  return (
    <div className="table-wrap tall">
      <table className="table dense">
        <thead><tr><th>{t("Date")}</th><th>{t("In")}</th><th>{t("Out")}</th><th>{t("End of day")}</th></tr></thead>
        <tbody>
          {s.days.map((d) => {
            const inflow = d.actualReceiptsSen + d.expectedReceiptsSen;
            return (
              <tr key={d.date} className={d.belowSafetyThreshold ? "row-alert" : ""}>
                <td data-label={t("Date")} className="nowrap">{formatMytDate(d.date, true)}</td>
                <td data-label={t("In")}>{inflow ? <Money sen={inflow} /> : <span className="muted">—</span>}</td>
                <td data-label={t("Out")}>{d.expensesSen ? <Money sen={-d.expensesSen} /> : <span className="muted">—</span>}</td>
                <td data-label={t("End of day")} className="nowrap"><Money sen={d.closingBalanceSen} strong />{d.belowSafetyThreshold && <span className="below"> · {t("below safety line")}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* Line chart: closing balance per day, two scenarios, safety line. One y-axis. */
function Chart({ f }: { f: Forecast }) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Draw in real pixels so axis text keeps its size on any screen width.
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 560 ? 220 : 280, L = 72, R = 12, T = 12, B = 28;
  const [onTime, delayed] = f.scenarios;
  const all = [...onTime.days, ...delayed.days].map((d) => d.closingBalanceSen).concat(f.safetyThresholdSen, 0);
  let max = Math.max(...all), min = Math.min(...all);
  const step = niceStep((max - min) / 4);
  max = Math.ceil(max / step) * step; min = Math.floor(min / step) * step;
  const n = onTime.days.length;
  const x = (i: number) => L + (i * (W - L - R)) / (n - 1);
  const y = (v: number) => T + ((max - v) * (H - T - B)) / (max - min || 1);
  const path = (days: ForecastDay[]) => days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.closingBalanceSen).toFixed(1)}`).join("");
  const ticks: number[] = [];
  for (let v = min; v <= max; v += step) ticks.push(v);
  const hoverDay = hover !== null ? { a: onTime.days[hover], b: delayed.days[hover] } : null;

  return (
    <div className="chart" ref={box}>
      <div className="legend" aria-hidden="true">
        <span><i className="sw sw-a" /> {t("Paid on time")}</span>
        <span><i className="sw sw-b" /> {t("Paid {n} days late", { n: delayed.delayDays })}</span>
        <span><i className="sw sw-s" /> {t("Safety line")} {formatSen(f.safetyThresholdSen)}</span>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Balance at the end of each day for 30 days. Exact values are under Day by day.")}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))));
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" />
            <text x={L - 8} y={y(t) + 4} className="axis" textAnchor="end">{formatSen(t).replace(".00", "")}</text>
          </g>
        ))}
        {onTime.days.map((d, i) => (i % (W < 560 ? 14 : 7) === 0 || (i === n - 1 && i % 7 > 3)) && (
          <text key={d.date} x={x(i)} y={H - 10} className="axis" textAnchor="middle">{shortMytDate(d.date)}</text>
        ))}
        <line x1={L} x2={W - R} y1={y(f.safetyThresholdSen)} y2={y(f.safetyThresholdSen)} className="safety" />
        <path d={path(onTime.days)} className="line line-a" />
        <path d={path(delayed.days)} className="line line-b" />
        {delayed.days.map((d, i) => d.belowSafetyThreshold && <circle key={d.date} cx={x(i)} cy={y(d.closingBalanceSen)} r={4} className="dot-alert" />)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="cross" />}
      </svg>
      {hoverDay && (
        <div className="tip" style={{ left: Math.min(Math.max(x(hover!), 90), W - 90) }}>
          <b>{formatMytDate(hoverDay.a.date, true)}</b>
          <div>{t("Paid on time")}: {formatSen(hoverDay.a.closingBalanceSen)}</div>
          <div>{t("Paid {n} days late", { n: delayed.delayDays })}: {formatSen(hoverDay.b.closingBalanceSen)}{hoverDay.b.belowSafetyThreshold ? ` · ${t("below safety line")}` : ""}</div>
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number): number {
  const sen = Math.max(raw, 100);
  const pow = 10 ** Math.floor(Math.log10(sen));
  const m = sen / pow;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow;
}
