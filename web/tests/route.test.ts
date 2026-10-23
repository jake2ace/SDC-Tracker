import { describe, expect, it } from "vitest";
import { href, parseRoute, PAGES } from "../src/lib/route";

describe("public website and workspace routes", () => {
  it("keeps the root and website section anchors on the public website", () => {
    for (const hash of ["", "#", "#main", "#how", "#capabilities", "#/unknown"]) {
      expect(parseRoute(hash).surface).toBe("website");
    }
  });

  it("opens each workspace section through an explicit URL", () => {
    for (const { id } of PAGES) {
      expect(parseRoute(href(id))).toEqual({ surface: "workspace", page: id, id: null, tab: "details" });
    }
  });

  it("preserves invoice details and tabs in shareable links", () => {
    expect(parseRoute(href("invoices", "INV/2026 01", "payment"))).toEqual({
      surface: "workspace", page: "invoices", id: "INV/2026 01", tab: "payment",
    });
    expect(parseRoute("#/invoices/INV-1/unknown").tab).toBe("details");
  });

  it("does not crash on a malformed invoice link", () => {
    expect(parseRoute("#/invoices/%E0%A4/payment")).toEqual({
      surface: "workspace", page: "invoices", id: null, tab: "payment",
    });
  });
});
