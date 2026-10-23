import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";
const KEY = "p2c.theme";

function initial(): Theme {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch { /* storage is optional */ }
  return "light";
}

/** A saved appearance always wins. New browsers start in the light workspace. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", theme === "dark" ? "#101110" : "#fafaf9");
  }, [theme]);
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try { window.localStorage.setItem(KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);
  return [theme, toggle];
}
