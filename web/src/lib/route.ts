import { useEffect, useState } from "react";
import { msg } from "../i18n";

export type Page = "home" | "invoices" | "bank" | "cash" | "activity";
export type InvoiceTab = "details" | "messages" | "payment";

export const PAGES: { id: Page; label: string }[] = [
  { id: "home", label: msg("Overview") },
  { id: "invoices", label: msg("Invoices") },
  { id: "bank", label: msg("Bank") },
  { id: "cash", label: msg("Cash") },
  { id: "activity", label: msg("Activity") },
];

export interface Route { surface: "website" | "workspace"; page: Page; id: string | null; tab: InvoiceTab }

const TABS: InvoiceTab[] = ["details", "messages", "payment"];

export function parseRoute(hash: string): Route {
  const [, page, id, tab] = hash.replace(/^#/, "").split("/");
  const known = PAGES.some((p) => p.id === page);
  let decodedId: string | null = null;
  if (known && id) {
    try { decodedId = decodeURIComponent(id); } catch { /* Ignore malformed links. */ }
  }
  return {
    surface: known ? "workspace" : "website",
    page: known ? (page as Page) : "home",
    id: decodedId,
    tab: TABS.includes(tab as InvoiceTab) ? (tab as InvoiceTab) : "details",
  };
}

export function href(page: Page, id?: string | null, tab?: InvoiceTab): string {
  return `#/${page}${id ? `/${encodeURIComponent(id)}${tab && tab !== "details" ? `/${tab}` : ""}` : ""}`;
}

export function navigate(page: Page, id?: string | null, tab?: InvoiceTab) {
  window.location.hash = href(page, id, tab).slice(1);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
