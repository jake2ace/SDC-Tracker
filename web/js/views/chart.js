import { h, svg } from '../dom.js';
import { ringgit, ringgitShort } from '../format.js';
import { L } from '../i18n.js';
import { D } from './ui.js';

const BLUE = '#2a78d6', ORANGE = '#eb6834', RED = '#b23a3a';

function niceStep(range) {
  const raw = range / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 2.5, 5, 10].find(n => n * pow >= raw) * pow;
  return unit;
}

// Draws the 30 daily closing balances of two scenarios. Values are sen.
// `active` is 'a' or 'b' and only changes which line is drawn on top.
export function balanceChart({ a, b, active, safetyLine, labelA, labelB, baseDate }) {
  const W = 900, H = 300, Lm = 64, R = 14, T = 18, B = 34;
  const days = a.days;
  const values = [...a.days, ...b.days].map(d => d.balance).concat([safetyLine, 0]);
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min -= 100000; max += 100000; }
  const step = niceStep(max - min);
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  const n = days.length - 1 || 1;
  const x = i => Lm + i * (W - Lm - R) / n;
  const y = v => T + (max - v) * (H - T - B) / (max - min);

  const nodes = [];
  for (let v = min; v <= max + 1; v += step) {
    nodes.push(svg('line', { x1: Lm, x2: W - R, y1: y(v), y2: y(v), stroke: v === 0 ? '#9aa7a1' : '#edf1ee' }));
    nodes.push(svg('text', { x: Lm - 10, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#86938e', text: ringgitShort(v) }));
  }
  nodes.push(svg('line', { x1: Lm, x2: W - R, y1: y(safetyLine), y2: y(safetyLine), stroke: RED, 'stroke-dasharray': '5 4', 'stroke-width': 1.3 }));
  const ticks = [0, 7, 14, 19, 24, n].filter((v, i, arr) => v <= n && arr.indexOf(v) === i);
  for (const i of ticks) {
    nodes.push(svg('text', { x: x(i), y: H - 10, 'text-anchor': i === 0 ? 'start' : i === n ? 'end' : 'middle', 'font-size': 11, fill: '#86938e', text: D(days[i].date) }));
  }
  const path = series => series.days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.balance).toFixed(1)}`).join(' ');
  const lines = [['a', a, BLUE], ['b', b, ORANGE]];
  if (active === 'a') lines.reverse();
  for (const [key, series, color] of lines) {
    nodes.push(svg('path', { d: path(series), fill: 'none', stroke: color, 'stroke-width': 2, opacity: key === active ? 1 : 0.35, 'stroke-linejoin': 'round' }));
  }
  const act = active === 'a' ? a : b;
  const bi = act.days.findIndex(d => d.belowSafety);
  if (bi >= 0) {
    const d = act.days[bi];
    const right = x(bi) > W - 200;
    nodes.push(svg('circle', { cx: x(bi), cy: y(d.balance), r: 5, fill: RED, stroke: '#fff', 'stroke-width': 2 }));
    nodes.push(svg('text', { x: x(bi) + (right ? -9 : 9), y: y(d.balance) + 18, 'text-anchor': right ? 'end' : 'start', 'font-size': 12, fill: RED,
      text: `${D(d.date)}  ${ringgit(d.balance)}` }));
  }
  nodes.push(svg('text', { x: x(0) + 2, y: T + 10, 'font-size': 11, fill: '#4b5d57', text: L(`Base date ${D(baseDate)}`, `基准日 ${D(baseDate)}`) }));
  const cross = svg('line', { x1: 0, x2: 0, y1: T, y2: H - B, stroke: '#4b5d57', 'stroke-width': 1, visibility: 'hidden' });
  nodes.push(cross);

  const tip = h('div', { class: 'tip', role: 'presentation' });
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img',
    'aria-label': L('Daily closing balance for the two scenarios, in ringgit', '两种情景下的每日余额（RM）') }, nodes);
  const hit = svg('rect', { x: Lm, y: T, width: W - Lm - R, height: H - T - B, fill: 'transparent' });
  chart.append(hit);
  const show = clientX => {
    const r = chart.getBoundingClientRect();
    const px = (clientX - r.left) * W / r.width;
    const i = Math.max(0, Math.min(n, Math.round((px - Lm) / ((W - Lm - R) / n))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    tip.style.display = 'block';
    tip.style.left = Math.max(0, Math.min(r.width - 190, x(i) * r.width / W + 10)) + 'px';
    tip.style.top = '10px';
    tip.replaceChildren(
      h('div', { class: 'muted' }, D(days[i].date)),
      h('div', h('i', { class: 'key key-a' }), ' ', h('b', ringgit(a.days[i].balance)), ' ', labelA),
      h('div', h('i', { class: 'key key-b' }), ' ', h('b', ringgit(b.days[i].balance)), ' ', labelB));
  };
  hit.addEventListener('pointermove', e => show(e.clientX));
  hit.addEventListener('pointerleave', () => { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); });
  return h('div', { class: 'chart-wrap' }, chart, tip);
}
