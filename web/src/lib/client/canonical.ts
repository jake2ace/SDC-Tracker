/** Stable JSON (sorted keys) used for idempotency fingerprints and fixture comparison. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec).filter((k) => rec[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(rec[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
