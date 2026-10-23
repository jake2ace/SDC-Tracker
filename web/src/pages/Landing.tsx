import { LangSwitch, useT } from "../i18n";
import type { Theme } from "../lib/theme";

/** Public intro page. Sign-in is a placeholder entry point; identities are synthetic demo users. */
export function Landing({ onSignIn, theme, onToggleTheme }: { onSignIn: () => void; theme: Theme; onToggleTheme: () => void }) {
  const t = useT();
  const steps = [
    { n: "01", title: t("Invoice and remind"), body: t("Turn a finished milestone into an invoice. Send polite reminders in English, Malay or Chinese after you approve them.") },
    { n: "02", title: t("Check every payment"), body: t("Paste the customer's reply or upload the transfer screenshot. It is checked against your bank statement before it counts.") },
    { n: "03", title: t("See your cash ahead"), body: t("A 30-day view of money in and out, with a warning when the balance may drop too low.") },
  ];
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="brand">
          <span className="logo" aria-hidden="true">M2C</span>
          <div className="brand-name">Milestone2Cash</div>
        </div>
        <div className="row gap">
          <LangSwitch />
          <button className="icon-btn" onClick={onToggleTheme} aria-label={theme === "dark" ? t("Light appearance") : t("Dark appearance")} title={theme === "dark" ? t("Light appearance") : t("Dark appearance")}>
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button className="btn btn-primary" onClick={onSignIn}>{t("Sign in")}</button>
        </div>
      </header>

      <main id="main" className="landing-main">
        <section className="hero">
          <div className="hero-text">
            <p className="eyebrow">proof-to-cash <span>/</span> v0.1 demo</p>
            <h1>{t("From finished milestone to confirmed cash")}</h1>
            <p className="lead">{t("Invoice on time, follow up politely, and check every \"dah bayar\" against bank records before it counts as money in.")}</p>
            <div className="row gap wrap">
              <button className="btn btn-primary btn-large" onClick={onSignIn}>{t("Sign in")}</button>
              <a className="btn btn-large btn-ghost" href="#how">{t("How it works")} ↓</a>
            </div>
            <p className="muted small">{t("Demo build with synthetic data. Not connected to real banks, WhatsApp or payment services.")}</p>
          </div>

          <div className="hero-card glass" aria-hidden="true">
            <div className="hc-top"><span className="mono">LUMEN-DEMO-001</span><span className="badge badge-warning">{t("Partially paid")}</span></div>
            <ol className="trace">
              <li><span className="trace-k">{t("Reply")}</span><span className="trace-v">“Dah bayar boss, RM9,000.”</span></li>
              <li><span className="trace-k">{t("Screenshot")}</span><span className="trace-v mono">RM 9,000.00 · LMN-231026-001</span></li>
              <li><span className="trace-k">{t("Bank check")}</span><span className="trace-v"><span className="badge badge-warning">{t("Partial · bank record found")}</span></span></li>
              <li><span className="trace-k">{t("Finance")}</span><span className="trace-v mono">+ RM 9,000.00</span></li>
            </ol>
            <div className="hc-foot">
              <span className="muted small">{t("Still due")}</span>
              <span className="mono strong-num">RM 9,000.00</span>
            </div>
            <div className="progress"><span style={{ width: "50%" }} /></div>
          </div>
        </section>

        <section id="how" className="landing-section">
          <h2>{t("How it works")}</h2>
          <ol className="steps">
            {steps.map((s) => (
              <li key={s.n} className="glass"><span className="step-num mono">{s.n}</span><h3>{s.title}</h3><p>{s.body}</p></li>
            ))}
          </ol>
        </section>

        <section className="signin-card glass">
          <div>
            <h2>{t("Sign in to your workspace")}</h2>
            <p className="muted">{t("Demo sign-in: no password needed. You can switch between demo companies and roles after signing in.")}</p>
          </div>
          <button className="btn btn-primary btn-large" onClick={onSignIn}>{t("Sign in")}</button>
        </section>
      </main>
      <footer className="landing-foot muted small mono">milestone2cash · {t("Synthetic demo data only")}</footer>
    </div>
  );
}
