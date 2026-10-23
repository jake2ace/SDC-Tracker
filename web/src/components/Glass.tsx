import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

const ACTIVE = '[aria-current="page"], [aria-current="true"], [aria-pressed="true"]';

/**
 * Liquid glass selection: one translucent puck that slides to whichever child is active.
 * Shared by the side navigation, tab bars and the language switch.
 */
export function useGlassPuck(container: RefObject<HTMLElement | null>, key: unknown): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () => {
      const active = el.querySelector<HTMLElement>(ACTIVE);
      if (!active) { setStyle(null); return; }
      const box = el.getBoundingClientRect();
      const r = active.getBoundingClientRect();
      setStyle({
        width: r.width,
        height: r.height,
        transform: `translate(${r.left - box.left + el.scrollLeft}px, ${r.top - box.top + el.scrollTop}px)`,
        // No slide on first paint, only when the selection moves.
        transition: first.current ? "none" : undefined,
      });
      first.current = false;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [container, key]);

  return style;
}

export function GlassPuck({ style }: { style: CSSProperties | null }) {
  if (!style) return null;
  return <span className="puck" style={style} aria-hidden="true" />;
}
