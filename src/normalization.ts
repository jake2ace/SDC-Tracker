/** Contract v1 reference comparison: preserve punctuation; never fuzzy-match. */
export function normalizeReference(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[\s\p{White_Space}]/gu, "");
}

/** Names are compared only against independently maintained customer aliases. */
export function normalizePayer(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[\s\p{White_Space}]+/gu, " ").trim();
}

export const normalizeBank = normalizePayer;
