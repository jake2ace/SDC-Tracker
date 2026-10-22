import { readFile } from 'node:fs/promises';
import { createForecastService } from '../src/forecast/service.mjs';

const seed = JSON.parse(await readFile(new URL('../data/demo.json', import.meta.url), 'utf8'));
const { stateFixtures } = JSON.parse(await readFile(new URL('../data/expected-results.json', import.meta.url), 'utf8'));
function fixture(name) {
  const definition = stateFixtures[name];
  const state = definition.extends ? fixture(definition.extends) : structuredClone(seed);
  Object.assign(state.settings, definition.settings ?? {});
  for (const { collection, id, set } of definition.updates ?? []) {
    Object.assign(state[collection].find(row => row.id === id), structuredClone(set));
  }
  for (const { collection, record } of definition.appends ?? []) {
    state[collection].push(structuredClone(record));
  }
  return state;
}
const money = value => `RM ${(value / 100).toFixed(2)}`;
console.log('Synthetic cash-flow scenarios; deterministic calculation, no AI or API key.');
for (const company of ['lumen', 'rantau']) {
  console.log(`\n${seed.companies.find(row => row.id === `co_${company}`).name}`);
  const state = fixture(company === 'lumen' ? 'lumen_issued' : 'seed');
  const service = createForecastService({ store: { read: () => structuredClone(state) } });
  for (const scenario of ['on_time', 'late']) {
    const query = scenario === 'late' ? { scenario, delayDays: 'beyond_window' } : { scenario };
    const { status, body } = await service.getForecast(`u_${company}_fin`, query);
    if (status !== 200) throw new Error(body.error.message);
    console.log(`${scenario}: end ${money(body.summary.endBalance)}, minimum ${money(body.summary.minBalance)}, first safety breach ${body.summary.firstBreachDate ?? 'none'}, maximum safety gap ${money(body.summary.maxGapToSafety)}`);
  }
  const paid = fixture(`${company}_paid`);
  paid.settings.demoDate = company === 'lumen' ? '2026-11-09' : '2026-11-08';
  const paidService = createForecastService({ store: { read: () => structuredClone(paid) } });
  const { status, body } = await paidService.getForecast(`u_${company}_fin`, { mode: 'rolling' });
  if (status !== 200) throw new Error(body.error.message);
  console.log(`paid + rolling from ${body.baseDate}: opening ${money(body.openingBalance)}, end ${money(body.summary.endBalance)} (received cash is not counted twice)`);
}
