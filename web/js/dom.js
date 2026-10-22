// Small DOM builder. Text always goes in as text nodes, so business strings from
// the backend (names, reminder text, rejection reasons) can never become markup.
// Nothing in this frontend parses HTML strings, on purpose.

const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(el, attrs) {
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
    else if (key === 'text') el.textContent = String(value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value' && 'value' in el) el.value = value;
    else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'open') el[key] = Boolean(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  apply(el, attrs);
  append(el, children);
  return el;
}

export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null) continue;
    if (key === 'text') el.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

// Re-rendering a page replaces its nodes. Keep focus and the caret where the
// user left them so typing isn't interrupted by a background refresh.
export function replaceKeepingFocus(container, nodes) {
  const active = document.activeElement;
  const id = active && container.contains(active) ? active.id : null;
  let start = null, end = null;
  if (id && 'selectionStart' in active) {
    try { start = active.selectionStart; end = active.selectionEnd; } catch { /* not a text field */ }
  }
  const scroll = new Map();
  for (const el of container.querySelectorAll('[data-keep-scroll]')) scroll.set(el.dataset.keepScroll, el.scrollTop);
  container.replaceChildren(...nodes.flat(Infinity).filter(n => n !== null && n !== undefined && n !== false));
  for (const el of container.querySelectorAll('[data-keep-scroll]')) {
    if (scroll.has(el.dataset.keepScroll)) el.scrollTop = scroll.get(el.dataset.keepScroll);
  }
  if (id) {
    const next = document.getElementById(id);
    if (next && !next.disabled) {
      next.focus({ preventScroll: true });
      if (start !== null) { try { next.setSelectionRange(start, end); } catch { /* ignore */ } }
    }
  }
}
