import { useState } from "react";
import { ThemeSwitch } from "../components/ThemeSwitch";
import { LangSwitch, useT } from "../i18n";
import type { Theme } from "../lib/theme";
import "./Landing.css";

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h16m-6-6 6 6-6 6"} /></svg>;
}

function FlowIcon({ kind }: { kind: "document" | "match" | "forecast" | "shield" }) {
  const paths = {
    document: <><path d="M7 3h7l4 4v14H7zM14 3v5h4M10 12h5M10 16h5" /><path d="M4 7v14" /></>,
    match: <><rect x="3" y="4" width="12" height="15" rx="2" /><path d="M6 8h6M6 12h4m3 5 3 3 5-7" /></>,
    forecast: <><path d="M4 4v16h17M7 15l4-5 4 3 5-7M16 6h4v4" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></>,
  };
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

/** Public introduction. Its walkthrough is a synthetic illustration, never an actual payment action. */
export function Landing({ onSignIn, theme, onToggleTheme }: { onSignIn: () => void; theme: Theme; onToggleTheme: () => void }) {
  const t = useT();
  const [stage, setStage] = useState(0);
  const stages = [
    { title: t("Customer evidence"), label: t("Payment claimed"), description: t("A reply or screenshot starts a review. It does not prove that money has arrived.") },
    { title: t("Extract the details"), label: t("Details to review"), description: t("OCR and AI help read the amount and reference. Finance can correct the extracted details.") },
    { title: t("Check bank records"), label: t("Finance approval needed"), description: t("Rules check the imported bank record. A matching amount still needs a person to approve it.") },
    { title: t("Confirm and trace"), label: t("Partial payment confirmed"), description: t("After finance approval, only RM9,000 is recorded. The other RM9,000 stays due and every action is logged.") },
  ];
  const active = stages[stage]!;
  const capabilities = [
    { kind: "document" as const, n: "01", title: t("Start with the milestone"), text: t("Turn completed work into an invoice draft. Review it, approve it, and keep the next follow-up visible."), detail: t("Milestones · invoices · reminders") },
    { kind: "match" as const, n: "02", title: t("Follow the evidence"), text: t("Bring customer replies, payment screenshots and bank records into one review. Catch mismatches and duplicate evidence."), detail: t("OCR · matching · finance approval") },
    { kind: "forecast" as const, n: "03", title: t("Plan around the balance"), text: t("Keep paid amounts separate from promises. Track the remaining balance and explore the next 30 days of cash flow."), detail: t("Partial payments · forecasts · activity") },
  ];

  return (
    <div className="m2c-landing">
      <header className="lp-nav">
        <a className="lp-brand" href="#main" aria-label="Milestone2Cash">
          <span className="lp-mark" aria-hidden="true"><svg viewBox="0 0 32 32" width="29" height="29" fill="none"><path d="M5 23V9l11 9L27 9v14" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" /><path d="M16 21v5" stroke="currentColor" strokeWidth="3" /></svg></span>
          <span>Milestone<span className="lp-brand-accent">2</span>Cash</span>
        </a>
        <nav className="lp-nav-links" aria-label={t("Product navigation")}>
          <a href="#how">{t("The workflow")}</a>
          <a href="#capabilities">{t("Capabilities")}</a>
        </nav>
        <div className="lp-preferences">
          <LangSwitch />
          <ThemeSwitch theme={theme} onToggleTheme={onToggleTheme} />
        </div>
      </header>

      <main id="main" className="lp-main">
        <section className="lp-hero" aria-labelledby="lp-title">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow"><span />{t("For project-based small businesses")}</p>
            <h1 id="lp-title">{t("Know what is paid.")} <span>{t("Know what is still due.")}</span></h1>
            <p className="lp-lead">{t("From a finished milestone to a verified payment. Give your team one clear place to invoice, check the evidence and follow up on the balance.")}</p>
            <div className="lp-actions">
              <button className="lp-primary" onClick={onSignIn}>{t("Open demo workspace")}<Arrow /></button>
              <a className="lp-text-link" href="#how">{t("Explore the workflow")}<Arrow diagonal /></a>
            </div>
            <p className="lp-demo-note">{t("Synthetic demo data. No real bank or WhatsApp connection.")}</p>
            <div className="lp-hero-principle"><FlowIcon kind="shield" /><span>{t("AI helps read. Rules check. Your team decides.")}</span></div>
          </div>

          <div className="lp-product-preview" aria-label={t("Synthetic payment walkthrough")}>
            <div className="lp-preview-chrome"><span className="lp-window-dots" aria-hidden="true"><i /><i /><i /></span><span>Milestone2Cash <span aria-hidden="true">/</span> {t("Proof to cash")}</span><span className="lp-example-tag">{t("Synthetic example")}</span></div>
            <div className="lp-preview-shell">
              <aside className="lp-preview-sidebar" aria-label={t("Product preview navigation")}>
                <span className="lp-preview-company"><span className="lp-company-mark" aria-hidden="true">L</span><span>Lumen Studio<small>{t("Demo company")}</small></span></span>
                <div className="lp-preview-menu"><span><FlowIcon kind="forecast" />{t("Overview")}</span><span><FlowIcon kind="document" />{t("Invoices")}</span><span className="is-current"><FlowIcon kind="match" />{t("Payment evidence")}</span><span><FlowIcon kind="shield" />{t("Activity log")}</span></div>
                <p className="lp-sidebar-note"><FlowIcon kind="shield" />{t("People stay in control")}</p>
              </aside>
              <div className="lp-preview-workspace">
                <div className="lp-preview-heading"><div><span className="lp-caption">{t("Project invoice")} / LUMEN-DEMO-001</span><h2>{t("Follow the evidence")}</h2></div><span className="lp-preview-date">23 OCT 2026</span></div>
                <dl className="lp-preview-metrics"><div><dt>{t("Invoice total")}</dt><dd>RM 18,000</dd></div><div><dt>{t("Paid")}</dt><dd>RM {stage === 3 ? "9,000" : "0"}<span>{stage === 3 ? t("Partial payment confirmed") : t("Awaiting finance approval")}</span></dd></div><div><dt>{t("Still due")}</dt><dd>RM {stage === 3 ? "9,000" : "18,000"}</dd></div></dl>
                <div className="lp-preview-detail">
          <div className="lp-evidence">
            <div className="lp-evidence-top"><span className="lp-eyebrow">{t("Proof to cash")}</span><span className="lp-evidence-reference">LUMEN-DEMO-001</span></div>
            <div className="lp-stage-switch" role="group" aria-label={t("Preview a workflow stage")}>
              {stages.map((item, index) => <button key={item.title} aria-pressed={stage === index} onClick={() => setStage(index)} aria-label={`${index + 1}. ${item.title}`} className={stage === index ? "is-active" : ""}><span>0{index + 1}</span><span>{item.title}</span></button>)}
            </div>
            <div className="lp-stage-panel" aria-live="polite" aria-atomic="true">
              <div className="lp-stage-label"><span className={`lp-state-dot ${stage === 3 ? "is-confirmed" : ""}`} /><span>{active.label}</span></div>
              {stage === 0 && <div className="lp-message"><span className="lp-message-label">{t("Customer reply")}</span><p>“Dah bayar boss, RM9,000.”</p><span className="lp-message-foot">{t("A claim to verify, not a receipt of funds")}</span></div>}
              {stage === 1 && <dl className="lp-proof-rows"><div><dt>{t("Amount")}</dt><dd>RM 9,000.00</dd></div><div><dt>{t("Reference")}</dt><dd>LMN-231026-001</dd></div><div><dt>{t("Review")}</dt><dd className="lp-review-text">{t("Check extracted fields")}</dd></div></dl>}
              {stage === 2 && <div className="lp-match-visual"><div><span>{t("Payment evidence")}</span><strong>RM 9,000</strong></div><span className="lp-match-symbol" aria-hidden="true">=</span><div><span>{t("Imported bank record")}</span><strong>RM 9,000</strong></div><p><FlowIcon kind="shield" />{t("Match found. Approval is still required.")}</p></div>}
              {stage === 3 && <div className="lp-settled"><div className="lp-balance-chart"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="40" className="lp-ring-base" /><circle cx="50" cy="50" r="40" className="lp-ring-paid" /></svg><span>50%<small>{t("Paid")}</small></span></div><div><span className="lp-caption">{t("Still due")}</span><strong>RM 9,000</strong><p>{t("Remaining balance stays open")}</p></div></div>}
              <p className="lp-stage-description">{active.description}</p>
            </div>
            <div className="lp-evidence-bottom"><span>{t("Illustration only · no transaction is created")}</span><button onClick={() => setStage((stage + 1) % stages.length)}>{stage === 3 ? t("Replay") : t("Next step")}<Arrow /></button></div>
          </div>
                  <aside className="lp-preview-trail"><p className="lp-eyebrow">{t("Decision trail")}</p><ol>{stages.map((item, index) => <li className={index <= stage ? "is-reached" : ""} key={item.title}><span className="lp-trail-marker" aria-hidden="true">{index < stage ? "✓" : index + 1}</span><div><strong>{item.title}</strong><span>{index === stage ? active.label : index < stage ? t("Reviewed in this example") : t("Next in the workflow")}</span></div></li>)}</ol><div className="lp-trail-principle"><FlowIcon kind="shield" /><p>{t("AI helps read. Rules check. Your team decides.")}</p></div></aside>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-workflow" id="how" aria-labelledby="lp-workflow-title">
          <div className="lp-section-intro"><p className="lp-eyebrow">{t("One connected workflow")}</p><h2 id="lp-workflow-title">{t("Keep the work, the proof and the balance together.")}</h2><p>{t("Built for teams that deliver work in stages and receive payment by bank transfer.")}</p></div>
          <ol className="lp-process">
            {[t("Complete a milestone"), t("Approve the invoice"), t("Review payment evidence"), t("Confirm and follow up")].map((label, index) => <li key={label}><span className="lp-process-number">0{index + 1}</span><span>{label}</span>{index < 3 && <Arrow />}</li>)}
          </ol>
        </section>

        <section className="lp-capabilities" id="capabilities" aria-labelledby="lp-capabilities-title">
          <div className="lp-section-heading"><div><p className="lp-eyebrow">{t("Less chasing. More clarity.")}</p><h2 id="lp-capabilities-title">{t("A focused workspace for getting paid.")}</h2></div><p>{t("The next action is clear, from the first invoice draft to the last outstanding amount.")}</p></div>
          <div className="lp-capability-list">{capabilities.map((item) => <article className="lp-capability" key={item.n}><div className="lp-capability-top"><FlowIcon kind={item.kind} /><span>{item.n}</span></div><h3>{item.title}</h3><p>{item.text}</p><span className="lp-capability-detail">{item.detail}</span></article>)}</div>
        </section>

        <section className="lp-control" aria-labelledby="lp-control-title">
          <div><span className="lp-control-icon"><FlowIcon kind="shield" /></span><p className="lp-eyebrow">{t("People stay in control")}</p><h2 id="lp-control-title">{t("A payment screenshot is the start of a check.")}<span>{t("Your approval is what makes it count.")}</span></h2></div>
          <div className="lp-control-list"><p><strong>{t("Review before recording")}</strong><span>{t("Uncertain or conflicting details go to finance. AI cannot approve a payment.")}</span></p><p><strong>{t("Keep the remainder visible")}</strong><span>{t("Partial payment reduces the balance. It does not close the invoice or stop follow-up on what is still due.")}</span></p><p><strong>{t("Trace the decision")}</strong><span>{t("See the evidence, the approval and the activity log behind a recorded payment.")}</span></p></div>
        </section>

        <section className="lp-final-cta" aria-labelledby="lp-start-title"><div><p className="lp-eyebrow">{t("Take a closer look")}</p><h2 id="lp-start-title">{t("Try the workflow with a demo company.")}</h2><p>{t("No password needed. Explore synthetic companies and switch between demo roles inside the workspace.")}</p></div><button className="lp-primary" onClick={onSignIn}>{t("Open demo workspace")}<Arrow /></button></section>
      </main>
      <footer className="lp-footer"><span>Milestone2Cash <span className="lp-footer-divider">/</span> Proof-to-Cash</span><span>{t("Synthetic demo data only")}<span className="lp-footer-divider">·</span><a href="#main">{t("Back to top")}</a></span></footer>
    </div>
  );
}
