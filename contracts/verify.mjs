import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import { CONTRACT_VERSION, DEMO_CLOCK, ENDPOINTS } from "./api.ts";

// Checks the specification and synthetic data, not a running backend or model.
const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const unique = (items, label) => assert.equal(new Set(items.map((x) => x.id)).size, items.length, `${label}: duplicate ID`);
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const validUtc = (value) => /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value)
  && validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
const mytDate = (value) => new Date(Date.parse(value) + 8 * 3_600_000).toISOString().slice(0, 10);
const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);
const rules = await read("rules.json");
const fixtures = await read("fixtures.json");
const seed = await read("../data/seed/demo-state.json");
let groups = 0;
function checked(name, fn) { fn(); groups++; console.log(`PASS ${name}`); }

checked("version, money, identity and approval boundaries", () => {
  assert.equal(rules.contractVersion, CONTRACT_VERSION);
  assert.equal(fixtures.contractVersion, CONTRACT_VERSION);
  assert.equal(fixtures.demoClock, DEMO_CLOCK);
  assert.equal(seed.metadata.asOf, DEMO_CLOCK);
  assert.equal(rules.moneyUnit, "sen");
  assert.equal(rules.matcher.amountToleranceSen, 0);
  assert.equal(rules.identity.roleInheritance, false);
  assert.equal(rules.ai.consequentialActionsAllowed, false);
  assert.equal(rules.forecast.partialPaymentStopsCollections, false);
  assert.deepEqual(rules.matcher.allowedApprovalVerdicts, ["confirmed", "partial"]);
});

checked("two-company seed graph and unpaid opening state", () => {
  const companyIds = new Set(seed.companies.map((x) => x.id));
  assert.deepEqual([...companyIds].sort(), ["co_lumen", "co_rantau"]);
  for (const [name, items] of Object.entries(seed)) {
    if (!Array.isArray(items)) continue;
    if (items.every((item) => "id" in item)) unique(items, name);
    for (const item of items) {
      if (item.companyId) assert(companyIds.has(item.companyId), `${name}: unknown tenant`);
      for (const [key, value] of Object.entries(item)) {
        if (key.endsWith("Sen") && value !== null) assert(Number.isSafeInteger(value), `${name}.${key}: fractional/unsafe sen`);
        if (key.endsWith("At") && value !== null) assert(validUtc(value), `${name}.${key}: invalid UTC`);
        if (key.endsWith("Date") && value !== null) assert(validDate(value), `${name}.${key}: invalid date`);
      }
      if (item.createdAt && item.updatedAt) assert(item.createdAt <= item.updatedAt, `${name}: reversed timestamps`);
    }
  }
  const relation = (from, foreignKey, to) => {
    for (const entity of seed[from]) {
      if (entity[foreignKey] === null) continue;
      const target = seed[to].find((x) => x.id === entity[foreignKey]);
      assert(target, `${from}.${foreignKey}: missing target`);
      assert.equal(entity.companyId, target.companyId, `${from}.${foreignKey}: cross-tenant reference`);
    }
  };
  for (const [from, key, to] of [
    ["projects", "customerId", "customers"], ["milestones", "projectId", "projects"],
    ["invoices", "milestoneId", "milestones"], ["invoices", "customerId", "customers"],
    ["replies", "invoiceId", "invoices"],
  ]) relation(from, key, to);
  for (const invoice of seed.invoices) {
    assert.equal(invoice.totalAmountSen, invoice.paidAmountSen + invoice.outstandingAmountSen);
    assert.equal(invoice.paidAmountSen, 0, "unapproved seed credits cannot become payments");
  }
  assert.equal(seed.payments.length, 0);
  assert(seed.bankCredits.every((credit) => credit.allocatedPaymentId === null));
});

for (const [suffix, companyId] of [["lumen", "co_lumen"], ["rantau", "co_rantau"]]) {
  const csv = await readFile(new URL(`../data/seed/bank-${suffix}.csv`, import.meta.url), "utf8");
  checked(`${companyId} CSV agrees with seed and frozen header`, () => {
    // These seed CSVs deliberately contain simple unquoted values. This is not the app's CSV parser.
    const [header, ...lines] = csv.trim().split(/\r?\n/).map((line) => line.split(","));
    assert.deepEqual(header, rules.uploads.csv.header);
    const credits = seed.bankCredits.filter((credit) => credit.companyId === companyId);
    assert.equal(lines.length, credits.length);
    for (const fields of lines) {
      assert.equal(fields.length, header.length);
      const row = Object.fromEntries(header.map((key, i) => [key, fields[i]]));
      const credit = credits.find((x) => x.externalId === row.externalId);
      assert(credit, "CSV row missing in seed");
      for (const key of header) assert.equal(String(credit[key]), row[key], `CSV ${key} differs`);
    }
  });
}

checked("API examples cover planned JSON endpoints and valid state transitions", () => {
  unique(fixtures.scenarios, "API examples");
  const covered = new Set();
  for (const scenario of fixtures.scenarios) {
    const endpoint = ENDPOINTS[scenario.operationId];
    assert(endpoint, `${scenario.id}: unknown operation`);
    covered.add(scenario.operationId);
    assert.equal(scenario.request.method, endpoint.method);
    assert(fixtures.states[scenario.stateId], `${scenario.id}: missing initial state`);
    assert(fixtures.states[scenario.nextStateId], `${scenario.id}: missing next state`);
    const path = scenario.request.path.split("?")[0];
    assert(new RegExp(`^${endpoint.path.replace(":id", "[^/]+")}$`).test(path), `${scenario.id}: route mismatch`);
    if (endpoint.method !== "GET") assert(new RegExp(rules.idempotency.keyPattern).test(scenario.request.headers["Idempotency-Key"]));
    assert.equal(scenario.response.body.meta.contractVersion, CONTRACT_VERSION);
    assert.equal(scenario.response.body.meta.mode, "demo");
    assert(validUtc(scenario.response.body.meta.asOf));
    if (scenario.response.status < 400) {
      assert("data" in scenario.response.body);
      if (scenario.operationId !== "listDemoUsers") {
        const actor = seed.users.find((x) => x.id === scenario.request.headers["X-Demo-User"]);
        assert(actor, `${scenario.id}: missing actor`);
        assert(endpoint.roles.includes(actor.role), `${scenario.id}: success for disallowed role`);
      }
    } else {
      assert(scenario.response.body.error.code);
      assert.equal(scenario.stateId, scenario.nextStateId, `${scenario.id}: error mutates domain state`);
    }
  }
  for (const [operation, endpoint] of Object.entries(ENDPOINTS)) {
    if (endpoint.format !== "image") assert(covered.has(operation), `No fixture for ${operation}`);
  }
  for (const [id, state] of Object.entries(fixtures.states)) {
    assert.equal(state.actor.companyId, state.company.id, `${id}: actor belongs to another company`);
    for (const entries of Object.values(state).filter(Array.isArray)) {
      for (const entity of entries) {
        if (entity.companyId) assert.equal(entity.companyId, state.company.id, `${id}: cross-company workspace data`);
      }
    }
    for (const invoice of state.invoices) {
      assert.equal(invoice.totalAmountSen, invoice.paidAmountSen + invoice.outstandingAmountSen, `${id}: invoice balance`);
      if (invoice.status === "partially_paid") {
        assert(invoice.outstandingAmountSen > 0);
        assert.notEqual(invoice.collectionStatus, "stopped");
      }
      if (invoice.status === "paid") {
        assert.equal(invoice.outstandingAmountSen, 0);
        assert.equal(invoice.collectionStatus, "stopped");
      }
    }
    assert.equal(new Set(state.payments.map((p) => p.bankCreditId)).size, state.payments.length, `${id}: reused credit`);
  }
});

const schema = await read("ai.schema.json");
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addFormat("date", { type: "string", validate: validDate });
ajv.addFormat("date-time", { type: "string", validate: validUtc });
ajv.addSchema(schema);
const validators = Object.fromEntries(["aiInput", "replyOutput", "receiptOutput", "reminderOutput"].map((name) => [name, ajv.compile({ $ref: `${schema.$id}#/$defs/${name}` })]));
checked("AI schemas accept documented payloads and reject unsafe structures", () => {
  const input = { task: "extract_reply", redactedText: "Payment promised on 2026-10-28.", language: "en", timezone: "Asia/Kuala_Lumpur", replyReceivedAt: DEMO_CLOCK };
  const reply = { intent: "promise", promisedDate: "2026-10-28", amountSen: 900000, confidence: 0.9 };
  const receipt = { bank: "DEMO BANK", amountSen: 900000, referenceToken: "REF_A", transferredAt: "2026-10-23T02:00:00Z", payerToken: "PAYER_A", confidence: 0.9 };
  for (const [name, value] of [["aiInput", input], ["replyOutput", reply], ["receiptOutput", receipt], ["reminderOutput", { draftText: "Please review the outstanding balance.", language: "en" }]]) assert(validators[name](value), JSON.stringify(validators[name].errors));
  for (const value of [{ ...input, rawImage: "image bytes" }, { ...input, companyRecord: {} }, { ...input, replyReceivedAt: "2026-10-23T12:00:00+08:00" }]) assert.equal(validators.aiInput(value), false);
  for (const value of [{ ...reply, amountSen: 1.5 }, { ...reply, amountSen: Number.MAX_SAFE_INTEGER + 1 }, { ...reply, promisedDate: "2026-02-30" }, { ...reply, confidence: 1.01 }, { ...reply, paid: true }]) assert.equal(validators.replyOutput(value), false);
  assert.equal(validators.receiptOutput({ ...receipt, referenceToken: "RAW ACCOUNT" }), false);
  assert.equal(validators.receiptOutput({ ...receipt, transferredAt: "2026-10-23T25:00:00Z" }), false);
});

const datasets = {};
for (const [name, inputName, count] of [["receipts", "manifest", 40], ["replies", "inputs", 40], ["matcher", "inputs", 30], ["forecast", "inputs", 4]]) {
  const inputs = await read(`../data/eval/${name}.${inputName}.json`);
  const gold = await read(`../data/eval/${name}.gold.json`);
  datasets[name] = { inputs, gold };
  checked(`${name}: separate inputs and labels with exact case coverage`, () => {
    assert.equal(inputs.metadata.synthetic, true);
    assert.equal(gold.metadata.synthetic, true);
    assert.equal(inputs.samples.length, count);
    assert.equal(gold.labels.length, count);
    unique(inputs.samples, `${name} inputs`); unique(gold.labels, `${name} labels`);
    assert.deepEqual(inputs.samples.map((x) => x.id).sort(), gold.labels.map((x) => x.id).sort());
    assert(!JSON.stringify(inputs.samples).includes('"expectedVerdict"'), "expected labels leaked into matcher inputs");
  });
}

checked("receipt asset plan and multilingual reply review boundaries", () => {
  const { inputs } = datasets.receipts;
  assert.equal(inputs.layouts.length, 4);
  for (const layout of inputs.layouts) assert.equal(inputs.samples.filter((x) => x.layoutId === layout.id).length, 10);
  for (const sample of inputs.samples) { assert.equal(sample.imagePath, null); assert(sample.assetStatus.includes("planned")); }
  assert.deepEqual([...new Set(datasets.replies.inputs.samples.map((x) => x.language))].sort(), ["en", "ms", "zh"]);
  assert(datasets.replies.gold.labels.every((x) => x.mustCreatePayment === false));
  for (const probe of datasets.replies.inputs.confidenceGuardProbes) {
    const expected = datasets.replies.gold.confidenceGuardExpectations.find((x) => x.id === probe.id);
    const c = probe.syntheticInjectedExtraction.confidence;
    assert.equal(expected.requiresExtractionReview, typeof c !== "number" || c < rules.matcher.confidenceThreshold || c > 1);
    assert.equal(expected.mustCreatePayment, false);
  }
});

checked("matcher labels preserve approval and outstanding-balance constraints", () => {
  assert.deepEqual([...new Set(datasets.matcher.gold.labels.map((x) => x.expectedVerdict))].sort(), [...rules.matcher.verdicts].sort());
  assert(datasets.matcher.gold.labels.some((x) => x.requiredReasons.includes("future_bank_posting") && x.expectedVerdict === "needs_review"), "Missing future bank posting negative case");
  for (const label of datasets.matcher.gold.labels) {
    assert.equal(label.mustPostPaymentWithoutApproval, false);
    assert.equal(label.eligibleForFinanceApproval, rules.matcher.allowedApprovalVerdicts.includes(label.expectedVerdict));
    if (!label.eligibleForFinanceApproval) continue;
    const { input } = datasets.matcher.inputs.samples.find((x) => x.id === label.id);
    const credit = input.bankCredits.find((x) => x.id === label.eligibleCreditId);
    assert(credit); assert.equal(credit.allocatedPaymentId, null);
    assert(credit.postedDate <= mytDate(input.asOf), "Cannot approve future bank posting");
    assert.equal(credit.amountSen, label.proposedPaymentAmountSen);
    assert.equal(input.invoice.outstandingAmountSen - credit.amountSen, label.proposedOutstandingAmountSen);
    assert(label.proposedOutstandingAmountSen >= 0);
  }
});

checked("hand-calculated forecast rows reconcile without inventing bank receipts", () => {
  for (const label of datasets.forecast.gold.labels) {
    const { input } = datasets.forecast.inputs.samples.find((x) => x.id === label.id);
    assert.equal(mytDate(input.asOf), input.asOfDate);
    assert.equal(label.days.length, 10);
    let balance = input.openingBalanceSen;
    for (const [index, day] of label.days.entries()) {
      assert.equal(day.date, new Date(Date.parse(`${input.asOfDate}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10));
      assert.equal(day.openingBalanceSen, balance);
      assert.equal(day.actualReceiptsSen, sum(input.payments.filter((p) => p.effectiveDate === day.date && p.confirmedAt <= input.asOf), "amountSen"));
      assert.equal(day.expectedReceiptsSen, sum(label.expectedReceiptSchedule.filter((p) => p.date === day.date), "amountSen"));
      assert.equal(day.expensesSen, sum(input.expenses.filter((p) => p.dueDate === day.date), "amountSen"));
      balance += day.actualReceiptsSen + day.expectedReceiptsSen - day.expensesSen;
      assert.equal(day.closingBalanceSen, balance);
      assert.equal(day.belowSafetyThreshold, balance < input.safetyThresholdSen);
    }
    for (const entry of label.expectedReceiptSchedule) {
      const invoice = input.invoices.find((x) => x.id === entry.invoiceId);
      assert.equal(entry.amountSen, invoice.outstandingAmountSen, "actual payment counted again as expected");
    }
  }
});

console.log(`Validated ${groups} contract/data groups. No app, OCR, model, matcher or deployment was executed.`);
