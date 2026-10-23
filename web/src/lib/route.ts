import { useEffect, useState } from "react";
import { msg } from "../i18n";

export type Page = "home" | "invoices" | "bank" | "cash" | "activity";
export type InvoiceTab = "details" | "messages" | "payment";

export const PAGES: { id: Page; label: string }[] = [
  { id: "home", label: msg("Home") },
  { id: "invoices", label: msg("Invoices") },
  { id: "bank", label: msg("Bank") },
  { id: "cash", label: msg("Cash") },
  { id: "activity", label: msg("Activity") },
];

export interface Route { page: Page; id: string | null; tab: InvoiceTab }

const TABS: InvoiceTab[] = ["details", "messages", "payment"];

function parse(): Route {
  const [, page, id, tab] = window.location.hash.replace(/^#/, "").split("/");
  const known = PAGES.some((p) => p.id === page);
  return {
    page: known ? (page as Page) : "home",
    id: known && id ? decodeURIComponent(id) : null,
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
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
