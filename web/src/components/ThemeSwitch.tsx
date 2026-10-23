import { useT } from "../i18n";
import type { Theme } from "../lib/theme";

/** Both appearances are explicit choices; the theme hook persists the selection. */
export function ThemeSwitch({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const t = useT();
  return (
    <div className="appearance-switch" role="group" aria-label={t("Appearance")}>
      <button type="button" aria-pressed={theme === "light"} title={t("Light appearance")}
        onClick={() => { if (theme !== "light") onToggleTheme(); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></svg>
        <span>{t("Light")}</span>
      </button>
      <button type="button" aria-pressed={theme === "dark"} title={t("Dark appearance")}
        onClick={() => { if (theme !== "dark") onToggleTheme(); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20 14.4A8.4 8.4 0 0 1 9.6 4a8.4 8.4 0 1 0 10.4 10.4Z" strokeLinejoin="round" /></svg>
        <span>{t("Dark")}</span>
      </button>
    </div>
  );
}
