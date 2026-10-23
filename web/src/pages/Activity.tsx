import { useMemo, useState } from "react";
import { useSession } from "../lib/session";
import { formatUtcAsMyt } from "../lib/format";
import { userName } from "../lib/selectors";
import { Badge, Empty, Field, Panel } from "../components/ui";
import { useT } from "../i18n";

export function ActivityPage() {
  const t = useT();
  const { workspace: ws, users } = useSession();
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    if (!ws) return [];
    const needle = q.trim().toLowerCase();
    return ws.activityLog
      .filter((e) => !needle || `${e.action} ${e.entityType} ${e.entityId} ${e.summary}`.toLowerCase().includes(needle))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }, [ws, q]);
  if (!ws) return null;

  return (
    <>
      <header className="page-head">
        <h1>{t("Activity")}</h1>
        <p className="muted">{t("Who did what, and when. Blocked attempts are listed too.")}</p>
      </header>
      <Panel>
        <Field label={t("Search")}>{(id) => <input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
        {rows.length === 0 ? <Empty title={ws.activityLog.length ? t("No events match") : t("No activity yet")} /> : (
          <ul className="rows">
            {rows.map((e) => (
              <li key={e.id}>
                <div className="row-main">
                  <div>
                    <div>{e.summary}</div>
                    <div className="muted small">{formatUtcAsMyt(e.occurredAt)} · {userName(ws, e.actorId, users)} · <code>{e.action}</code></div>
                  </div>
                  {e.outcome === "succeeded" ? <Badge tone="success">{t("Done")}</Badge> : <Badge tone="danger">{t("Blocked")}{e.reasonCode ? ` · ${e.reasonCode}` : ""}</Badge>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
