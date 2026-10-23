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
import { pendingCounts } from "./lib/selectors";
import { useTheme, type Theme } from "./lib/theme";
import { GlassPuck, useGlassPuck } from "./components/Glass";

const SIGNED_IN = "p2c.signedIn";
function readSignedIn(): boolean {
  try { return window.localStorage.getItem(SIGNED_IN) === "1"; } catch { return false; }
}

export function App() {
  const [signedIn, setSignedIn] = useState(readSignedIn);
  const [theme, toggleTheme] = useTheme();
  const signIn = () => {
    try { window.localStorage.setItem(SIGNED_IN, "1"); } catch { /* optional */ }
    setSignedIn(true);
    navigate("home");
  };
  const signOut = () => {
    try { window.localStorage.removeItem(SIGNED_IN); } catch { /* optional */ }
    setSignedIn(false);
    window.location.hash = "";
  };
  return signedIn
    ? <Workspace onSignOut={signOut} theme={theme} onToggleTheme={toggleTheme} />
    : <Landing onSignIn={signIn} theme={theme} onToggleTheme={toggleTheme} />;
}

function isTyping(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

function Workspace({ onSignOut, theme, onToggleTheme }: { onSignOut: () => void; theme: Theme; onToggleTheme: () => void }) {
  const t = useT();
  const { users, actor, switchActor, workspace, status, error, refresh, source, toasts, dismissToast, usersError, asOf, revision } = useSession();
  const route = useRoute();
  const [controlsOpen, setControlsOpen] = useState(false);
  const companies = Array.from(new Set(users.map((u) => u.companyId)));
  const counts = workspace ? pendingCounts(workspace) : null;
  const navRef = useRef<HTMLUListElement>(null);
  const puck = useGlassPuck(navRef, route.page);

  useEffect(() => {
    // Keys 1 to 5 jump between sections, unless someone is typing.
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const page = PAGES[Number(e.key) - 1];
      if (page) { e.preventDefault(); navigate(page.id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <a className="skip" href="#main">{t("Skip to content")}</a>
      <div className="demo-strip" role="note">
        {t("Demo with synthetic data. Nothing here touches a real bank or customer.")}{" "}
        <span className="muted-strip">{source === "mock" ? t("Source: mock fixtures") : t("Source: local demo API")}</span>
      </div>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">M2C</span>
          <div>
            <div className="brand-name">Milestone2Cash</div>
            <div className="brand-sub">Proof-to-Cash</div>
          </div>
        </div>
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
          <LangSwitch />
          <details className="menu">
            <summary aria-label={t("More")}>⋯</summary>
            <div className="menu-pop">
              <button onClick={onToggleTheme}>{theme === "dark" ? t("Light appearance") : t("Dark appearance")}</button>
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
              <div className="company-name">{workspace.company.name}</div>
              <div className="muted tiny">{actor ? t(ROLE_LABEL[actor.role]) : ""}</div>
              <div className="muted tiny today">{t("Today (demo)")}: {formatUtcAsMyt(asOf)}</div>
            </div>
          )}
          <ul ref={navRef} className="glass-track">
            <GlassPuck style={puck} />
            {PAGES.map((p, i) => {
              const count = counts?.[p.id] ?? 0;
              return (
                <li key={p.id}>
                  <a href={`#/${p.id}`} aria-current={route.page === p.id ? "page" : undefined}
                    onClick={(e) => { e.preventDefault(); navigate(p.id); }}>
                    <span>{t(p.label)}</span>
                    {count > 0 ? <span className="count" aria-label={t("{n} items need attention", { n: count })}>{count}</span> : <kbd aria-hidden="true">{i + 1}</kbd>}
                  </a>
                </li>
              );
            })}
          </ul>
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
