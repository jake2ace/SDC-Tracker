import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import type { ForecastDay, ForecastInput } from "../contracts/domain.ts";
import { calculateForecast } from "../src/forecast.ts";

const inputText = readFileSync(new URL("../data/eval/forecast.inputs.json", import.meta.url), "utf8");
const goldText = readFileSync(new URL("../data/eval/forecast.gold.json", import.meta.url), "utf8");
const source = readFileSync(new URL("../src/forecast.ts", import.meta.url));
const inputs = JSON.parse(inputText) as { samples: { id: string; input: ForecastInput }[] };
const gold = JSON.parse(goldText) as { metadata: { comparisonFields: (keyof ForecastDay)[] }; labels: {
  id: string; windowDays: number; days: Partial<ForecastDay>[];
  expectedReceiptSchedule: { invoiceId: string; date: string; amountSen: number }[];
}[] };
if (inputs.samples.length !== 4 || gold.labels.length !== 4 ||
    new Set(inputs.samples.map(sample => sample.id)).size !== 4 ||
    new Set(gold.labels.map(label => label.id)).size !== 4) throw new Error("Expected four unique frozen forecast cases and labels.");

const results = inputs.samples.map(sample => {
  const label = gold.labels.find(value => value.id === sample.id);
  if (!label || label.windowDays !== 10) throw new Error(`Missing ten-day label for ${sample.id}`);
  const before = JSON.stringify(sample.input);
  const actual = calculateForecast(sample.input);
  const scenario = actual.scenarios[sample.input.delayDays === 0 ? 0 : 1];
  const days = scenario.days.slice(0, label.windowDays).map(day =>
    Object.fromEntries(gold.metadata.comparisonFields.map(field => [field, day[field]])));
  const schedule = scenario.entries.filter(entry => entry.kind === "expected_receipt")
    .map(({ invoiceId, date, amountSen }) => ({ invoiceId, date, amountSen }));
  const daysCorrect = isDeepStrictEqual(days, label.days);
  const scheduleCorrect = isDeepStrictEqual(schedule, label.expectedReceiptSchedule);
  const deterministic = isDeepStrictEqual(actual, calculateForecast(structuredClone(sample.input)));
  const unchanged = JSON.stringify(sample.input) === before;
  const horizonCorrect = actual.scenarios.every(value => value.days.length === 30);
  const traceable = actual.scenarios.every(value => value.days.every(day => isDeepStrictEqual(day.entryIds,
    value.entries.filter(entry => entry.date === day.date).map(entry => entry.id))));
  return { id: sample.id, checkedGoldDays: label.windowDays, daysCorrect, scheduleCorrect, deterministic,
    unchanged, horizonCorrect, traceable, passed: daysCorrect && scheduleCorrect && deterministic && unchanged && horizonCorrect && traceable };
});
const passed = results.filter(result => result.passed).length;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
console.log(JSON.stringify({
  evaluation: "deterministic-forecast-frozen-synthetic-cases", evaluatedAt: new Date().toISOString(), runtime: process.version,
  inputSha256: hash(inputText), goldSha256: hash(goldText), sourceSha256: { "forecast.ts": hash(source) },
  sampleCount: results.length, passed, failed: results.length - passed,
  checkedGoldDays: results.reduce((total, result) => total + result.checkedGoldDays, 0),
  scope: "Four frozen synthetic cases, each compared exactly with ten independently hand-calculated days and the expected receipt schedule. All outputs cover 30 days; this is not a statistical forecast or a production banking validation.",
  results,
}, null, 2));
if (passed !== results.length) process.exitCode = 1;
