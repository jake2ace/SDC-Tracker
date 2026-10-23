import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { GlassPuck, useGlassPuck } from "../components/Glass";
import { zh } from "./zh";
import { ms } from "./ms";
import { setDateLanguage } from "../lib/format";

/**
 * Interface language only. English text is the key; zh and ms dictionaries translate it.
 * Customer data, server messages and audit summaries are shown as stored, never translated here.
 */
export type Lang = "en" | "zh" | "ms";
export const LANGS: { id: Lang; label: string; htmlLang: string }[] = [
  { id: "en", label: "EN", htmlLang: "en" },
  { id: "zh", label: "中文", htmlLang: "zh-Hans" },
  { id: "ms", label: "BM", htmlLang: "ms" },
];

const DICTS: Record<Exclude<Lang, "en">, Record<string, string>> = { zh, ms };
export type Vars = Record<string, string | number>;

export function translate(lang: Lang, text: string, vars?: Vars): string {
  const base = lang === "en" ? text : DICTS[lang][text] ?? text;
  return vars ? base.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : base;
}

const KEY = "p2c.lang";
function initial(): Lang {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === "en" || saved === "zh" || saved === "ms") return saved;
  } catch { /* storage is optional */ }
  return "en";
}

setDateLanguage(initial());

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: "en", setLang: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  useEffect(() => {
    document.documentElement.lang = LANGS.find((l) => l.id === lang)!.htmlLang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setDateLanguage(l);
    setLangState(l);
    try { window.localStorage.setItem(KEY, l); } catch { /* ignore */ }
  }, []);
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export function useLang() { return useContext(LangContext); }

export type T = (text: string, vars?: Vars) => string;
export function useT(): T {
  const { lang } = useContext(LangContext);
  return useCallback((text: string, vars?: Vars) => translate(lang, text, vars), [lang]);
}

export function LangSwitch() {
  const { lang, setLang } = useLang();
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const puck = useGlassPuck(ref, lang);
  return (
    <div ref={ref} className="seg lang-switch glass-track" role="group" aria-label={t("Interface language")}>
      <GlassPuck style={puck} />
      {LANGS.map((l) => (
        <button key={l.id} type="button" className={lang === l.id ? "on" : ""} aria-pressed={lang === l.id} lang={l.htmlLang} onClick={() => setLang(l.id)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

/** Marks an English string for translation where t() is not available yet (constant tables). */
export const msg = (text: string): string => text;
