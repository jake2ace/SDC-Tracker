import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { zh } from "../src/i18n/zh";
import { ms } from "../src/i18n/ms";
import { translate } from "../src/i18n";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}

/** Every English string passed to t("…") or msg("…") in the source. */
export function collectKeys(): string[] {
  const keys = new Set<string>();
  const re = /\b(?:t|msg)\(\s*"((?:[^"\\]|\\.)*)"/g;
  for (const f of files(join(__dirname, "../src"))) {
    if (f.includes("/i18n/")) continue;
    for (const m of readFileSync(f, "utf8").matchAll(re)) keys.add(JSON.parse(`"${m[1]}"`) as string);
  }
  return [...keys].sort();
}

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("translations", () => {
  const keys = collectKeys();
  for (const [name, dict] of [["zh", zh], ["ms", ms]] as const) {
    it(`${name} covers every interface string`, () => {
      expect(keys.filter((k) => !(k in dict))).toEqual([]);
    });
    it(`${name} keeps the same placeholders`, () => {
      expect(keys.filter((k) => k in dict && vars(k) !== vars(dict[k]))).toEqual([]);
    });
  }
  it("falls back to English and fills placeholders", () => {
    expect(translate("en", "{n} days late", { n: 7 })).toBe("7 days late");
    expect(translate("zh", "not a real key")).toBe("not a real key");
  });
});
