// Display helpers only. Amounts arrive from the backend as integer sen,
// so we split them with integer maths and never round through floats.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MINUS = '−';

function group(whole) {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 1800000 -> "RM18,000", -500000 -> "RM−5,000", 1350050 -> "RM13,500.50"
export function ringgit(sen, { signed = false } = {}) {
  if (!Number.isSafeInteger(sen)) return 'n/a';
  const negative = sen < 0;
  const abs = Math.abs(sen);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const body = group(whole) + (cents ? '.' + String(cents).padStart(2, '0') : '');
  if (signed) return (negative ? MINUS : '+') + 'RM' + body;
  return 'RM' + (negative ? MINUS : '') + body;
}

// Short axis label, e.g. 2500000 -> "RM25k"
export function ringgitShort(sen) {
  if (!Number.isFinite(sen)) return '';
  if (sen === 0) return 'RM0';
  const k = Math.abs(sen) / 100000;
  const text = Number.isInteger(k) ? String(k) : k.toFixed(1);
  return 'RM' + (sen < 0 ? MINUS : '') + text + 'k';
}

export function parseIsoDate(value) {
  const m = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function shortDate(value, lang = 'en') {
  const p = parseIsoDate(value);
  if (!p) return value ?? '';
  return lang === 'zh' ? `${p.m}月${p.d}日` : `${p.d} ${MONTHS[p.m - 1]}`;
}

export function longDate(value, lang = 'en') {
  const p = parseIsoDate(value);
  if (!p) return value ?? '';
  return lang === 'zh' ? `${p.y}年${p.m}月${p.d}日` : `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

// Backend timestamps are real clock times. Show them in the viewer's timezone.
export function clockTime(iso, lang = 'en') {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const day = lang === 'zh' ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `${day} ${hh}:${mm}`;
}

export function addDaysIso(value, days) {
  const p = parseIsoDate(value);
  if (!p) return value;
  const t = Date.UTC(p.y, p.m - 1, p.d) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  const a = parseIsoDate(from), b = parseIsoDate(to);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}
