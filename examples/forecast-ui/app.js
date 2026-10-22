'use strict';

// This view renders only the local preview server's synthetic scenarios.
// No model output, user-controlled HTML, remote assets, or financial calculation runs here.
const byId = id => document.getElementById(id);
const controls = { company: byId('company'), case: byId('case'), mode: byId('mode') };
const scenarioButtons = [...document.querySelectorAll('[data-scenario]')];
const demoCase = byId('demo-case');
// Presets change request inputs only; displayed balances always come from the service.
// These acceptance notes are expectations to compare, not automatic pass indicators.
const demoCases = [
  { id: 'lumen_on_time', label: '01 · Lumen：按时收款', company: 'lumen', case: 'lumen_issued', mode: 'fixed', scenario: 'on_time', story: '项目已开票，客户按约定日期付款，团队按计划支付开支。', check: '期末 RM 13,000；30 天内不低于安全线。' },
  { id: 'lumen_late_7', label: '02 · Lumen：延迟 7 天', company: 'lumen', case: 'lumen_issued', mode: 'fixed', scenario: '7', story: '客户晚付一周。虽然月底余额不变，期间仍可能没钱周转。', check: '期末仍为 RM 13,000；11 月 10 日起，累计 2 天低于安全线。' },
  { id: 'lumen_late_14', label: '03 · Lumen：延迟 14 天', company: 'lumen', case: 'lumen_issued', mode: 'fixed', scenario: '14', story: '客户晚付两周。和晚付一周相比，资金紧张持续得更久。', check: '期末仍为 RM 13,000；低于安全线的天数从 2 天增加到 9 天。' },
  { id: 'lumen_beyond', label: '04 · Lumen：窗口外到账', company: 'lumen', case: 'lumen_issued', mode: 'fixed', scenario: 'beyond_window', story: '客户的款项推迟到这 30 天之后，计划内的支出仍需支付。', check: '期末 −RM 5,000；11 月 10 日首次低于安全线，最大安全缺口 RM 15,000。' },
  { id: 'lumen_paid', label: '05 · Lumen：已收款不再延迟', company: 'lumen', case: 'lumen_paid', mode: 'fixed', scenario: 'beyond_window', story: '客户实际已付款。即使选择“窗口外到账”，也不能推迟或重复计算这笔实际收款。', check: '期末 RM 13,000；明细保留实际收款，按时与当前情景的曲线重合。' },
  { id: 'lumen_rolling', label: '06 · Lumen：收款后滚动预测', company: 'lumen', case: 'lumen_paid', mode: 'rolling', scenario: 'beyond_window', story: '收款后，从新的演示日期再看未来 30 天，历史收支已结转到期初。', check: '期初 RM 38,000、期末 RM 13,000；已结转的收款不再次进入窗口收入。' },
  { id: 'rantau_beyond', label: '07 · Rantau：逾期款继续推迟', company: 'rantau', case: 'seed', mode: 'fixed', scenario: 'beyond_window', story: '换到活动公司 Rantau，客户已有逾期欠款。如果继续收不到款，开支会造成资金缺口。', check: '期末 −RM 3,000；10 月 30 日首次低于安全线，最大安全缺口 RM 11,000。' },
  { id: 'rantau_rolling', label: '08 · Rantau：已收款与未来款分开', company: 'rantau', case: 'rantau_paid', mode: 'rolling', scenario: 'beyond_window', story: 'Rantau 收回逾期款后滚动预测。历史收款进入期初，尚未收到的未来款仍受延迟情景影响。', check: '期初 RM 19,500；当前情景期末 RM 10,500，按时到账对照为 RM 28,500。' },
];
const moneyFormat = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat('en-MY', { notation: 'compact', maximumFractionDigits: 1 });
const SVG_NS = 'http://www.w3.org/2000/svg';
let selectedScenario = 'beyond_window';
let requestNumber = 0;
let pendingRequest;

function text(id, value) { byId(id).textContent = value; }
function money(sen) {
  const units = BigInt(sen), absolute = units < 0n ? -units : units;
  const cents = absolute % 100n;
  return `RM ${units < 0n ? '−' : ''}${moneyFormat.format(absolute / 100n)}${cents ? `.${String(cents).padStart(2, '0')}` : ''}`;
}
function shortDate(date) { return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`; }
function create(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}
function svgElement(tag, attributes = {}, content) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (content !== undefined) element.textContent = content;
  return element;
}

function updateBusinessCases() {
  const options = controls.company.value === 'lumen'
    ? [['seed', '阶段未完成'], ['lumen_issued', '已开票，等待收款'], ['lumen_paid', '已收到款项']]
    : [['seed', '已开票，款项已逾期'], ['rantau_paid', '已收到款项']];
  controls.case.replaceChildren(...options.map(([value, label]) => {
    const option = create('option', '', label);
    option.value = value;
    return option;
  }));
}

function selectScenario(value) {
  selectedScenario = value;
  for (const button of scenarioButtons) button.setAttribute('aria-pressed', String(button.dataset.scenario === value));
}

function markCustomCase() {
  demoCase.value = 'custom';
  text('demo-story', '你已调整演示条件。当前结果按下方选中的公司、业务状态、窗口和回款情景重新计算。');
  text('demo-check', '对照收支明细检查余额和日期；切换上方案例可恢复预设条件与对应的验收重点。');
}

function applyDemoCase(id) {
  const preset = demoCases.find(item => item.id === id);
  if (!preset) return;
  demoCase.value = preset.id;
  controls.company.value = preset.company;
  updateBusinessCases();
  controls.case.value = preset.case;
  controls.mode.value = preset.mode;
  selectScenario(preset.scenario);
  text('demo-story', preset.story);
  text('demo-check', preset.check);
  loadPreview();
}

function resetResults(message) {
  for (const id of ['opening', 'ending', 'breach', 'gap']) {
    text(id, '—');
    byId(id).classList.remove('negative', 'positive');
  }
  text('opening-hint', '窗口开始前的资金');
  text('ending-hint', '第 30 天的日终余额');
  text('safety-hint', '根据日终余额判断');
  text('gap-hint', '同时区分负余额缺口');
  text('chart-period', '每日收支计入后的余额 · MYR');
  text('chart-summary', '曲线和下方明细展示同一份测算结果。');
  text('line-count', '—');
  byId('chart').replaceChildren(create('p', 'empty-state', message));
  const row = create('tr');
  const cell = create('td', 'table-empty', message);
  cell.colSpan = 5;
  row.append(cell);
  byId('source-rows').replaceChildren(row);
}

function validForecast(forecast) {
  const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const integer = value => Number.isSafeInteger(value);
  if (!forecast || !Array.isArray(forecast.days) || forecast.days.length !== 30 || !Array.isArray(forecast.lines) || forecast.lines.length > 10000) return false;
  if (![forecast.openingBalance, forecast.safetyLine].every(integer) || !validDate(forecast.baseDate) || !validDate(forecast.endDate)) return false;
  if (!forecast.days.every(day => day && validDate(day.date) && [day.balance, day.inflow, day.outflow].every(integer))) return false;
  const summary = forecast.summary;
  if (!summary || ![summary.endBalance, summary.maxGapToSafety, summary.maxShortfallBelowZero, summary.breachDays].every(integer)) return false;
  if (summary.firstBreachDate !== null && !validDate(summary.firstBreachDate)) return false;
  return forecast.lines.every(line => line && typeof line.id === 'string' && validDate(line.date) && validDate(line.originalDate) && integer(line.amount) && typeof line.included === 'boolean' && line.ref && typeof line.ref === 'object');
}

async function loadPreview() {
  const currentRequest = ++requestNumber;
  pendingRequest?.abort();
  const controller = new AbortController();
  pendingRequest = controller;
  byId('results').setAttribute('aria-busy', 'true');
  byId('error').hidden = true;
  byId('error').textContent = '';
  resetResults('正在加载当前公司的预测…');
  text('window-caption', '正在读取所选演示数据…');
  text('load-status', '正在更新…');

  const params = new URLSearchParams({
    company: controls.company.value,
    case: controls.case.value,
    mode: controls.mode.value,
    scenario: selectedScenario === 'on_time' ? 'on_time' : 'late',
  });
  if (selectedScenario !== 'on_time') params.set('delayDays', selectedScenario);
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`/api/preview?${params}`, { signal: controller.signal, credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('preview unavailable');
    const data = await response.json();
    if (currentRequest !== requestNumber) return;
    if (typeof data.companyName !== 'string' || !validForecast(data.forecast) || !validForecast(data.onTime)) throw new Error('invalid response');
    render(data);
    text('load-status', '已更新 · 仅使用当前公司的合成数据');
  } catch {
    if (currentRequest !== requestNumber) return;
    resetResults('当前预测暂不可用');
    text('window-caption', '未显示任何公司的预测数据。');
    text('load-status', '加载失败');
    byId('error').textContent = '无法加载当前预测。请检查本地预览服务是否运行，然后重新选择情景以重试。';
    byId('error').hidden = false;
  } finally {
    clearTimeout(timeout);
    if (currentRequest === requestNumber) byId('results').setAttribute('aria-busy', 'false');
  }
}

function render({ companyName, forecast, onTime, demoDate }) {
  text('window-caption', `${companyName} · ${forecast.baseDate} 至 ${forecast.endDate} · 30 天，包含首尾日${typeof demoDate === 'string' ? ` · 演示日期 ${demoDate}` : ''}`);
  text('opening', money(forecast.openingBalance));
  text('opening-hint', `${shortDate(forecast.baseDate)} · 开始前`);
  text('ending', money(forecast.summary.endBalance));
  byId('ending').classList.toggle('negative', forecast.summary.endBalance < 0);
  byId('ending').classList.toggle('positive', forecast.summary.endBalance >= forecast.safetyLine);
  text('ending-hint', `${shortDate(forecast.endDate)} · 日终`);
  text('breach', forecast.summary.firstBreachDate ? shortDate(forecast.summary.firstBreachDate) : '未低于安全线');
  text('safety-hint', `安全线 ${money(forecast.safetyLine)}`);
  text('gap', money(forecast.summary.maxGapToSafety));
  byId('gap').classList.toggle('negative', forecast.summary.maxGapToSafety > 0);
  text('gap-hint', `负余额最大缺口 ${money(forecast.summary.maxShortfallBelowZero)}`);
  text('chart-period', `${shortDate(forecast.baseDate)} — ${shortDate(forecast.endDate)} · 每日日终余额 · MYR`);
  const status = forecast.summary.firstBreachDate
    ? `当前情景下，${shortDate(forecast.summary.firstBreachDate)}首次低于安全线，共 ${forecast.summary.breachDays} 天。`
    : '当前情景下，30 天内的日终余额均未低于安全线。';
  text('chart-summary', `${status}${selectedScenario === 'on_time' ? ' 当前情景与按时到账曲线重合。' : ''}`);
  renderChart(forecast, onTime);
  renderSources(forecast, onTime);
}

function renderChart(forecast, onTime) {
  const width = 980, height = 290;
  const plot = { left: 71, top: 28, right: 35, bottom: 39 };
  const values = [...forecast.days.map(day => day.balance), ...onTime.days.map(day => day.balance), forecast.safetyLine, 0];
  const low = Math.min(...values), high = Math.max(...values);
  const padding = Math.max((high - low) * .15, 10000);
  const min = low - padding, max = high + padding;
  const x = index => plot.left + index * (width - plot.left - plot.right) / 29;
  const y = value => plot.top + (max - value) / (max - min) * (height - plot.top - plot.bottom);
  const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-labelledby': 'balance-chart-title balance-chart-description' });
  svg.append(svgElement('title', { id: 'balance-chart-title' }, '未来 30 天日终余额对比'));
  svg.append(svgElement('desc', { id: 'balance-chart-description' }, `${byId('chart-summary').textContent} 期末余额 ${money(forecast.summary.endBalance)}。下方来源表提供每笔款项和计入日期。`));
  for (let index = 0; index <= 4; index++) {
    const value = min + (max - min) * index / 4;
    svg.append(svgElement('line', { x1: plot.left, x2: width - plot.right, y1: y(value), y2: y(value), class: 'chart-grid' }));
    svg.append(svgElement('text', { x: plot.left - 12, y: y(value) + 4, 'text-anchor': 'end', class: 'chart-label' }, compactFormat.format(value / 100)));
  }
  for (const index of [0, 5, 10, 15, 20, 25, 29]) {
    svg.append(svgElement('text', { x: x(index), y: height - 12, 'text-anchor': 'middle', class: 'chart-label' }, shortDate(forecast.days[index].date)));
  }
  svg.append(svgElement('line', { x1: plot.left, x2: width - plot.right, y1: y(forecast.safetyLine), y2: y(forecast.safetyLine), class: 'chart-safety' }));
  const pathFor = days => days.map((day, index) => index === 0 ? `M ${x(0)} ${y(day.balance)}` : `H ${x(index)} V ${y(day.balance)}`).join(' ');
  svg.append(svgElement('path', { d: pathFor(onTime.days), class: 'chart-path on-time' }));
  svg.append(svgElement('path', { d: pathFor(forecast.days), class: 'chart-path selected' }));
  byId('chart').replaceChildren(svg);
}

function lineStatus(line) {
  if (!line) return create('span', 'inclusion excluded', '不在此情景');
  const reasons = { after_window: '窗口之后', before_base: '已结转期初', rejected_draft: '草稿已被驳回', pushed_beyond_window: '推迟到窗口外' };
  const cell = create('span');
  cell.append(create('span', `inclusion${line.included ? '' : ' excluded'}`, line.included ? `${shortDate(line.date)}计入` : reasons[line.excludeReason] || '本窗口不计入'));
  if (line.assumedToday) cell.append(create('span', 'assumption', '逾期款假设于窗口首日到账'));
  return cell;
}

function renderSources(forecast, onTime) {
  const rows = [];
  const opening = create('tr');
  opening.append(create('td', '', shortDate(forecast.baseDate)), create('td', '', '期初余额'), create('td', 'number-column', money(forecast.openingBalance)));
  for (let index = 0; index < 2; index++) {
    const cell = create('td');
    cell.append(create('span', 'inclusion opening', '窗口起点'));
    opening.append(cell);
  }
  rows.push(opening);
  const currentById = new Map(forecast.lines.map(line => [line.id, line]));
  const onTimeById = new Map(onTime.lines.map(line => [line.id, line]));
  const unique = new Map([...onTime.lines, ...forecast.lines].map(line => [line.id, line]));
  const lines = [...unique.values()].sort((a, b) => a.originalDate.localeCompare(b.originalDate) || a.id.localeCompare(b.id));
  for (const line of lines) {
    const row = create('tr');
    const details = create('td');
    const title = line.kind === 'expense' ? line.ref.expenseLabel || '计划支出' : line.ref.invoiceNo || line.ref.milestoneName || '项目应收款';
    const kind = { expense: '计划支出', actual_receipt: '实际收款', expected_receipt: '预计收款' }[line.kind] || '业务款项';
    details.append(create('span', 'row-title', title), create('span', 'row-detail', [line.ref.clientName, kind].filter(value => typeof value === 'string' && value.length).join(' · ')));
    row.append(create('td', '', shortDate(line.originalDate)), details, create('td', `number-column ${line.amount > 0 ? 'amount-income' : 'amount-expense'}`, `${line.amount > 0 ? '+' : ''}${money(line.amount)}`));
    for (const source of [onTimeById, currentById]) {
      const cell = create('td');
      cell.append(lineStatus(source.get(line.id)));
      row.append(cell);
    }
    rows.push(row);
  }
  text('line-count', `${lines.length} 笔来源`);
  byId('source-rows').replaceChildren(...rows);
}

controls.company.addEventListener('change', () => {
  updateBusinessCases();
  markCustomCase();
  loadPreview();
});
for (const control of [controls.case, controls.mode]) {
  control.addEventListener('change', () => {
    markCustomCase();
    loadPreview();
  });
}
for (const button of scenarioButtons) {
  button.addEventListener('click', () => {
    selectScenario(button.dataset.scenario);
    markCustomCase();
    loadPreview();
  });
}
demoCase.replaceChildren(...demoCases.map(preset => {
  const option = create('option', '', preset.label);
  option.value = preset.id;
  return option;
}));
const customOption = create('option', '', '自定义条件');
customOption.value = 'custom';
customOption.disabled = true;
demoCase.append(customOption);
demoCase.addEventListener('change', () => applyDemoCase(demoCase.value));
applyDemoCase('lumen_beyond');
