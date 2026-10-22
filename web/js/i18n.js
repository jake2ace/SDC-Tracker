// The product is English. Chinese is a development aid only and the toggle is
// hidden unless the web server runs with DEV_CHINESE=1.

let lang = 'en';

export function getLang() { return lang; }
export function setLang(next) { lang = next === 'zh' ? 'zh' : 'en'; }

// L('Mark done', '标为完成') picks the string for the current language.
export function L(en, zh) {
  return lang === 'zh' && zh !== undefined ? zh : en;
}

export function plural(n, one, many) {
  return n === 1 ? one : many;
}
