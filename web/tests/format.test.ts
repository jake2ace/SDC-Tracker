import { describe, expect, it } from "vitest";
import { daysBetween, formatMytDate, formatSen, formatUtcAsMyt, mytDateOf, mytLocalInputToUtc, parseRinggitToSen } from "../src/lib/format";

describe("money", () => {
  it("formats integer sen without floats", () => {
    expect(formatSen(1800000)).toBe("RM 18,000.00");
    expect(formatSen(899999)).toBe("RM 8,999.99");
    expect(formatSen(-400000)).toBe("−RM 4,000.00");
    expect(formatSen(5, { signed: true })).toBe("+RM 0.05");
  });
  it("parses typed ringgit into sen", () => {
    expect(parseRinggitToSen("9,000.00")).toBe(900000);
    expect(parseRinggitToSen("RM 9000.5")).toBe(900050);
    expect(parseRinggitToSen("0.10")).toBe(10);
    for (const bad of ["9,00", "9.999", "-1", "1e3", "abc", ""]) expect(parseRinggitToSen(bad)).toBeNull();
  });
});

describe("MYT dates", () => {
  it("keeps business dates on the MYT calendar", () => {
    expect(formatMytDate("2026-10-30", true)).toBe("Fri 30 Oct 2026");
    expect(daysBetween("2026-10-16", "2026-10-23")).toBe(7);
  });
  it("converts instants to MYT", () => {
    expect(formatUtcAsMyt("2026-10-23T04:00:00Z")).toBe("23 Oct 2026, 12:00 MYT");
    expect(mytDateOf("2026-10-22T16:30:00Z")).toBe("2026-10-23");
    expect(mytLocalInputToUtc("2026-10-23T11:30")).toBe("2026-10-23T03:30:00Z");
  });
});

describe("date wording follows the interface language", () => {
  it("keeps the same MYT day in every language", async () => {
    const f = await import("../src/lib/format");
    f.setDateLanguage("zh");
    expect(f.formatMytDate("2026-10-30", true)).toBe("2026年10月30日 周五");
    f.setDateLanguage("ms");
    expect(f.formatMytDate("2026-08-30")).toBe("30 Ogo 2026");
    f.setDateLanguage("en");
  });
});
