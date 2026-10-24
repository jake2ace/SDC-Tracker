import { useEffect, useRef, useState } from "react";
import { formatUtcAsMyt } from "./lib/format";
import { PAGES, navigate, useRoute } from "./lib/route";
import { useSession } from "./lib/session";
import { LangSwitch, useT } from "./i18n";
import { ErrorNote, Loading, ROLE_LABEL } from "./components/ui";
import { DemoControls } from "./components/DemoControls";
import { Landing } from "./pages/Landing";
import { HomePage } from "./pages/Home";
import { InvoicesPage } from "./pages/Invoices";
import { BankPage } from "./pages/Bank";
import { CashPage } from "./pages/Cash";
import { ActivityPage } from "./pages/Activity";
import { invoiceTasks } from "./lib/tasks";
import { useTheme, type Theme } from "./lib/theme";
import { GlassPuck, useGlassPuck } from "./components/Glass";
import { ThemeSwitch } from "./components/ThemeSwitch";

const SIGNED_IN = "p2c.signedIn";
export function App() {
  const route = useRoute();
  const [theme, toggleTheme] = useTheme();
  const signIn = () => {
    try { window.localStorage.setItem(SIGNED_IN, "1"); } catch { /* optional */ }
    navigate("home");
  };
  const signOut = () => {
    try { window.localStorage.removeItem(SIGNED_IN); } catch { /* optional */ }
    window.location.hash = "";
  };
  // This is a synthetic demo, not an authentication boundary. The URL chooses
  // the public website or workspace, even after a previous demo visit.
  return route.surface === "workspace"
    ? <Workspace onSignOut={signOut} theme={theme} onToggleTheme={toggleTheme} />
    : <Landing onSignIn={signIn} theme={theme} onToggleTheme={toggleTheme} />;
}

function NavIcon({ page }: { page: string }) {
  const paths: Record<string, string> = {
    home: "M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
    invoices: "M6 3h12v18l-3-2-3 2-3-2-3 2ZM9 8h6M9 12h6",
    bank: "M3 8h18L12 3ZM5 11v7m5-7v7m4-7v7m5-7v7M3 21h18",
    cash: "M4 4v16h17M8 15l4-4 4 2 5-7",
    activity: "M3 12h4l3-7 4 14 3-7h4",
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[page] ?? paths.home} /></svg>;
}

function Workspace({ onSignOut, theme, onToggleTheme }: { onSignOut: () => void; theme: Theme; onToggleTheme: () => void }) {
  const t = useT();
  const { users, actor, switchActor, workspace, status, error, refresh, source, toasts, dismissToast, usersError, asOf, revision } = useSession();
  const route = useRoute();
  const [controlsOpen, setControlsOpen] = useState(false);
  const [focusInvoiceSearch, setFocusInvoiceSearch] = useState(false);
  const companies = Array.from(new Set(users.map((u) => u.companyId)));
  const pending = workspace ? invoiceTasks(workspace, t).length : 0;
  const navRef = useRef<HTMLUListElement>(null);
  const puck = useGlassPuck(navRef, route.page);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.page, route.id, route.tab]);

  useEffect(() => {
    if (!focusInvoiceSearch || route.page !== "invoices" || !workspace) return;
    const input = document.getElementById("invoice-search");
    if (input) { input.focus(); setFocusInvoiceSearch(false); }
  }, [focusInvoiceSearch, route.page, workspace]);


  return (
    <div className="app">
      <a className="skip" href="#main" onClick={(event) => {
        event.preventDefault();
        document.getElementById("main")?.focus();
      }}>{t("Skip to content")}</a>
      <div className="demo-strip" role="note">
        {t("Demo with synthetic data. Nothing here touches a real bank or customer.")}{" "}
        <span className="muted-strip">{source === "mock" ? t("Source: mock fixtures") : t("Connected demo workspace")}</span>
      </div>
      <header className="topbar">
        <a className="brand" href="#" aria-label={t("Website home")} title={t("Website home")}>
          <span className="logo" aria-hidden="true">M2C</span>
          <div>
            <div className="brand-name">Milestone2Cash</div>
            <div className="brand-sub">{t("Website home")} <span aria-hidden="true">↗</span></div>
          </div>
        </a>
        <button className="workspace-search-trigger" type="button" disabled={!workspace} aria-label={t("Search invoices…")}
          onClick={() => { setFocusInvoiceSearch(true); navigate("invoices"); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <span>{t("Search invoices…")}</span>
        </button>
        <div className="topbar-right">
          <label className="user-switch">
            <span className="sr-only">{t("Demo identity")}</span>
            <select value={actor?.id ?? ""} onChange={(e) => switchActor(e.target.value)} disabled={!users.length} title={t("Demo identity")}>
              {companies.map((c) => (
                <optgroup key={c} label={c === "co_lumen" ? "Studio Lumen Demo" : c === "co_rantau" ? "Rantau IT Demo" : c}>
                  {users.filter((u) => u.companyId === c).map((u) => (
                    <option key={u.id} value={u.id}>{u.displayName} · {t(ROLE_LABEL[u.role])}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <ThemeSwitch theme={theme} onToggleTheme={onToggleTheme} />
          <LangSwitch />
          <details className="menu">
            <summary aria-label={t("More")}>⋯</summary>
            <div className="menu-pop">
              <button onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; setControlsOpen(true); }}>{t("Demo tools")}</button>
              <button onClick={onSignOut}>{t("Sign out")}</button>
            </div>
          </details>
        </div>
      </header>

      <div className="layout">
        <nav className="sidenav" aria-label={t("Main")}>
          {workspace && (
            <div className="company-card">
              <span className="company-avatar" aria-hidden="true">{workspace.company.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span>
              <div className="company-name">{workspace.company.name}</div>
              <div className="muted tiny">{actor ? t(ROLE_LABEL[actor.role]) : ""}</div>
              <div className="muted tiny today">{t("Today (demo)")}: {formatUtcAsMyt(asOf)}</div>
            </div>
          )}
          <div className="nav-caption">{t("WORKSPACE")}</div>
          <ul ref={navRef} className="glass-track">
            <GlassPuck style={puck} />
            {PAGES.map((p) => {
              const count = p.id === "invoices" ? pending : 0;
              return (
                <li key={p.id}>
                  <a href={`#/${p.id}`} aria-current={route.page === p.id ? "page" : undefined}
                    onClick={(e) => { e.preventDefault(); navigate(p.id); }}>
                    <span className="nav-label"><NavIcon page={p.id} />{t(p.label)}</span>
                    {count > 0 && <span className="count" title={t("{n} pending tasks", { n: count })} aria-label={t("{n} pending tasks", { n: count })}>{count}</span>}
                  </a>
                </li>
              );
            })}
          </ul>
          <div className="nav-footer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="m8 12 3 3 5-6" /></svg>
            <strong>{t("Every payment, accounted for.")}</strong>
            <p>{t("Human approval. Clear evidence. A record of every decision.")}</p>
            <a href="#/activity" onClick={(event) => { event.preventDefault(); navigate("activity"); }}>{t("View activity log")} <span aria-hidden="true">↗</span></a>
          </div>
        </nav>

        <main id="main" tabIndex={-1}>
          {usersError && <ErrorNote error={usersError} read />}
          {status === "loading" && !workspace && <Loading label={t("Loading company workspace…")} />}
          {status === "error" && error && <ErrorNote error={error} read onRetry={() => void refresh()} />}
          {workspace && (
            // A different identity starts with fresh forms, uploads and selections.
            <div key={`${workspace.actor.id}:${revision}`} className="page">
              {route.page === "home" && <HomePage />}
              {route.page === "invoices" && <InvoicesPage selectedId={route.id} tab={route.tab} />}
              {route.page === "bank" && <BankPage />}
              {route.page === "cash" && <CashPage />}
              {route.page === "activity" && <ActivityPage />}
            </div>
          )}
        </main>
      </div>

      <div className="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast toast-${x.tone}`}>
            <span>{x.text}</span>
            <button className="btn-x" onClick={() => dismissToast(x.id)} aria-label={t("Dismiss")}>×</button>
          </div>
        ))}
      </div>
      {controlsOpen && <DemoControls key={`${actor?.id}:${revision}`} onClose={() => setControlsOpen(false)} />}
    </div>
  );
}
