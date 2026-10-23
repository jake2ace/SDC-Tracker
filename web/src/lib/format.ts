import type { MytDate, Sen, UtcTimestamp } from "./contract";

export const MYT = "Asia/Kuala_Lumpur";
const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Integer sen to "RM 18,000.00". No float arithmetic on money. */
export function formatSen(sen: Sen | null | undefined, opts: { signed?: boolean } = {}): string {
  if (sen === null || sen === undefined) return "—";
  if (!Number.isSafeInteger(sen)) return "Invalid amount";
  const negative = sen < 0;
  const abs = Math.abs(sen);
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = negative ? "−" : opts.signed && sen > 0 ? "+" : "";
  return `${sign}RM ${grouped}.${cents}`;
}

/**
 * Parse a user-typed ringgit amount into integer sen using string math.
 * Accepts "9000", "9,000", "9000.5", "9,000.50". Returns null when invalid.
 */
export function parseRinggitToSen(input: string): Sen | null {
  const text = input.trim().replace(/^RM\s*/i, "");
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(text)) return null;
  const [wholePart, fraction = ""] = text.replace(/,/g, "").split(".");
  const sen = Number(wholePart) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(sen) ? sen : null;
}

/** Sen to an editable input value, e.g. 900000 -> "9000.00". */
export function senToInput(sen: Sen | null | undefined): string {
  if (sen === null || sen === undefined) return "";
  return `${Math.floor(sen / 100)}.${String(sen % 100).padStart(2, "0")}`;
}

type DateLang = "en" | "zh" | "ms";
const NAMES: Record<DateLang, { months: string[]; weekdays: string[] }> = {
  en: { months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] },
  ms: { months: ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"], weekdays: ["Ahd", "Isn", "Sel", "Rab", "Kha", "Jum", "Sab"] },
  zh: { months: [], weekdays: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] },
};
/** Date wording follows the interface language; the calendar is always MYT. */
let dateLang: DateLang = "en";
export function setDateLanguage(lang: DateLang) { dateLang = lang; }

function dayLabel(y: number, m: number, d: number, weekday?: number): string {
  const n = NAMES[dateLang];
  if (dateLang === "zh") return `${y}年${m}月${d}日${weekday !== undefined ? ` ${n.weekdays[weekday]}` : ""}`;
  return `${weekday !== undefined ? n.weekdays[weekday] + " " : ""}${d} ${n.months[m - 1]} ${y}`;
}

function splitDate(date: MytDate): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Business date stays a MYT calendar date. Never passed through the browser timezone. */
export function formatMytDate(date: MytDate | null | undefined, withWeekday = false): string {
  if (!date) return "—";
  const p = splitDate(date);
  if (!p) return date;
  const weekday = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  return dayLabel(p[0], p[1], p[2], withWeekday ? weekday : undefined);
}

export function shortMytDate(date: MytDate): string {
  const p = splitDate(date);
  if (!p) return date;
  return dateLang === "zh" ? `${p[1]}月${p[2]}日` : `${p[2]} ${NAMES[dateLang].months[p[1] - 1]}`;
}

/** UTC instant shown in MYT, e.g. "23 Oct 2026, 12:00 MYT". */
export function formatUtcAsMyt(ts: UtcTimestamp | null | undefined): string {
  if (!ts) return "—";
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return ts;
  const d = new Date(ms + MYT_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dayLabel(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())}${dateLang === "zh" ? " " : ", "}${hh}:${mm} MYT`;
}

/** MYT calendar date of a UTC instant. */
export function mytDateOf(ts: UtcTimestamp): MytDate {
  const d = new Date(Date.parse(ts) + MYT_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Whole days from a to b (b - a) on the MYT calendar. */
export function daysBetween(a: MytDate, b: MytDate): number {
  const pa = splitDate(a), pb = splitDate(b);
  if (!pa || !pb) return 0;
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86_400_000);
}

/** "2026-10-23T11:30" typed as MYT wall time -> "2026-10-23T03:30:00Z". */
export function mytLocalInputToUtc(value: string): UtcTimestamp | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - MYT_OFFSET_MS;
  return new Date(ms).toISOString().replace(".000Z", "Z");
}

export function utcToMytLocalInput(ts: UtcTimestamp): string {
  const d = new Date(Date.parse(ts) + MYT_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}
