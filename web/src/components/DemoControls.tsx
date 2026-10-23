import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSession } from "../lib/session";
import { STATE_LABELS, type FixtureScenario } from "../lib/client/mock";
import { ClientError } from "../lib/client/types";
import { Badge, ErrorNote } from "./ui";
import { useT } from "../i18n";

/** Reviewer tools: fixture states, error drills and data-source info. Clearly outside the product UI. */
export function DemoControls({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { mock, source, actor, pushToast } = useSession();
  const dialog = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<ClientError | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [, rerender] = useState(0);
  // Re-render whenever the mock ledger changes.
  useSyncExternalStore((cb) => mock?.subscribe(cb) ?? (() => {}), () => (mock && actor ? mock.currentState(actor.companyId) + String(mock.options.failNextRequest) : "api"));

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const company = actor?.companyId ?? "co_lumen";
  const current = mock?.currentState(company);
  const scenarios = mock ? mock.scenariosFrom(company) : [];

  async function run(s: FixtureScenario) {
    if (!mock) return;
    setRunning(s.id); setError(null);
    try {
      await mock.runScenario(s);
      pushToast("success", t("Fixture {id} applied.", { id: s.id }));
    } catch (e) {
      setError(e instanceof ClientError ? e : new ClientError({ kind: "bad_response", message: String(e) }));
    } finally { setRunning(null); }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="dc-title" tabIndex={-1} ref={dialog} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2 id="dc-title">{t("Demo tools")}</h2>
          <button className="btn btn-ghost" onClick={onClose}>{t("Close")}</button>
        </header>
        <p className="muted small">{t("For reviewers and the demo video. Not part of the product.")}</p>

        <section>
          <h3>{t("Data source")}</h3>
          {source === "mock" ? (
            <p><Badge tone="mock">{t("Mock fixtures")}</Badge> {t("Every result comes from contracts/fixtures.json. Add ?source=api to the address to use the local backend.")}</p>
          ) : (
            <p><Badge tone="info">{t("Local demo API")}</Badge> {t("All workflow steps use the local API, including bank checks, payment approval and forecasts. Add ?source=mock for fixtures.")}</p>
          )}
        </section>

        {mock && (
          <>
            <section>
              <h3>{t("Fixture state")}</h3>
              <label className="field">
                <span>{t("Current state for this company")}</span>
                <select value={current} onChange={(e) => mock.setState(company, e.target.value)}>
                  {mock.statesFor(company).map((id) => <option key={id} value={id}>{STATE_LABELS[id] ?? id} ({id})</option>)}
                </select>
              </label>
              <div className="row gap">
                <button className="btn" onClick={() => mock.reset()}>{t("Reset all demo data")}</button>
              </div>
            </section>

            <section>
              <h3>{t("Failure drills")}</h3>
              <label className="check">
                <input type="checkbox" checked={mock.options.aiUnavailable}
                  onChange={(e) => { mock.options.aiUnavailable = e.target.checked; rerender((n) => n + 1); pushToast("info", e.target.checked ? t("Reply extraction will use the AI-unavailable fixture.") : t("Reply extraction back to normal.")); }} />
                {t("AI unavailable for reply extraction")}
              </label>
              <label className="check">
                <input type="checkbox" checked={mock.options.failNextRequest}
                  onChange={(e) => { mock.options.failNextRequest = e.target.checked; rerender((n) => n + 1); pushToast("info", e.target.checked ? t("The next request will fail before saving anything.") : t("Network drill off.")); }} />
                {t("Fail the next request (network)")}
              </label>
            </section>

            <section>
              <h3>{t("Recorded requests from this state")}</h3>
              <p className="muted small">{t("Replays the exact fixture request, including error drills such as wrong role, stale version or reused credit.")}</p>
              {error && <ErrorNote error={error} onDismiss={() => setError(null)} />}
              {scenarios.length === 0 && <p className="muted small">{t("No recorded write requests start from this state.")}</p>}
              <ul className="scenario-list">
                {scenarios.map((s) => (
                  <li key={s.id}>
                    <div>
                      <code>{s.id}</code>
                      <div className="muted tiny">{s.operationId} · as {s.request.headers["X-Demo-User"]} · HTTP {s.response.status}{s.nextStateId !== s.stateId ? ` → ${s.nextStateId}` : ""}</div>
                    </div>
                    <button className="btn btn-small" disabled={running !== null} onClick={() => void run(s)}>
                      {running === s.id ? t("Running…") : t("Run")}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
