import fixturesJson from "../../../../contracts/fixtures.json";
import {
  CONTRACT_VERSION, DEMO_CLOCK, ENDPOINTS,
  type ApiError, type ApiMeta, type ApiOperations, type DemoUser, type ErrorCode, type Workspace,
} from "../contract";
import { canonical } from "./canonical";
import { ClientError, type DataClient, type OperationId, type RequestParams } from "./types";

interface FixtureRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number>;
  multipart?: { fields: Record<string, string>; file: { fixtureId: string; fileName: string; mimeType: string } };
}
export interface FixtureScenario {
  id: string;
  operationId: OperationId;
  stateId: string;
  nextStateId: string;
  description: string;
  request: FixtureRequest;
  response: { status: number; body: unknown };
}
interface Fixtures {
  contractVersion: string;
  states: Record<string, Workspace>;
  scenarios: FixtureScenario[];
  textFixtures: { id: string; mimeType: string; text: string }[];
  binaryFixtures: { id: string; status: string; mimeType: string }[];
}

const fixtures = fixturesJson as unknown as Fixtures;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Fields a person is expected to type freely; the fixture response is still the approved one. */
const FREE_TEXT_KEYS = new Set(["text", "reason"]);

export interface MockOptions {
  latencyMs: number;
  /** Prefer the approved "AI unavailable" fixture for reply extraction. */
  aiUnavailable: boolean;
  /** Fail the next request before it reaches the mock ledger (tests retry with the same key). */
  failNextRequest: boolean;
}

export type MockNote = { scenarioId: string; message: string };

/**
 * Fixture-driven mock. Each successful write moves the company from scenario.stateId to
 * scenario.nextStateId and returns the recorded response, so the UI sees exactly the
 * contract DTOs the backend will return. No business rule is computed here.
 */
export class MockClient implements DataClient {
  readonly source = "mock" as const;
  readonly options: MockOptions = { latencyMs: 350, aiUnavailable: false, failNextRequest: false };
  private stateByCompany: Record<string, string> = { co_lumen: "before", co_rantau: "rantau" };
  private idempotency = new Map<string, { fingerprint: string; status: number; body: unknown; nextStateId: string }>();
  private listeners = new Set<() => void>();
  lastNote: MockNote | null = null;

  static readonly fixtures = fixtures;

  supports(): boolean { return true; }

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { this.listeners.forEach((fn) => fn()); }

  get users(): DemoUser[] {
    const s = fixtures.scenarios.find((x) => x.operationId === "listDemoUsers")!;
    return clone((s.response.body as ApiOperations["listDemoUsers"]["response"]).data.users);
  }

  currentState(companyId: string): string { return this.stateByCompany[companyId]; }

  statesFor(companyId: string): string[] {
    return Object.keys(fixtures.states).filter((id) => fixtures.states[id].company.id === companyId);
  }

  /** Demo control: jump to an approved fixture state (also clears idempotency records). */
  setState(companyId: string, stateId: string) {
    if (fixtures.states[stateId]?.company.id !== companyId) return;
    this.stateByCompany[companyId] = stateId;
    this.idempotency.clear();
    this.emit();
  }

  reset() {
    this.stateByCompany = { co_lumen: "before", co_rantau: "rantau" };
    this.idempotency.clear();
    this.lastNote = null;
    this.emit();
  }

  scenariosFrom(companyId: string): FixtureScenario[] {
    const state = this.stateByCompany[companyId];
    return fixtures.scenarios.filter((s) => s.stateId === state && ENDPOINTS[s.operationId].method !== "GET");
  }

  /** Replays a fixture request exactly as recorded (used by the demo scenario runner). */
  async runScenario(s: FixtureScenario) {
    const id = /\/api\/[a-z-]+\/([^/]+)\//.exec(s.request.path)?.[1];
    return this.request(s.operationId, {
      actorId: s.request.headers["X-Demo-User"],
      id,
      body: s.request.body,
      idempotencyKey: s.request.headers["Idempotency-Key"],
      query: s.request.query ? Object.fromEntries(Object.entries(s.request.query).map(([k, v]) => [k, String(v)])) : undefined,
      multipart: s.request.multipart ? {
        fields: s.request.multipart.fields,
        file: this.fixtureFile(s.request.multipart.file.fixtureId, s.request.multipart.file.fileName, s.request.multipart.file.mimeType),
      } : undefined,
    });
  }

  /** Approved synthetic files a person can "pick" in mock mode. */
  fixtureFile(fixtureId: string, fileName: string, mimeType: string): File {
    const text = fixtures.textFixtures.find((t) => t.id === fixtureId)?.text;
    // Receipt images are planned_not_generated in contract v1.0.0; an empty marker file stands in.
    const file = new File([text ?? `fixture:${fixtureId}`], fileName, { type: mimeType });
    return file;
  }

  textFixtures() { return fixtures.textFixtures; }

  private meta(replayed: boolean, id = "mock"): ApiMeta {
    return { requestId: `req_${id}`, contractVersion: CONTRACT_VERSION, mode: "demo", asOf: DEMO_CLOCK, idempotencyReplayed: replayed };
  }

  private fail(status: number, code: ErrorCode, message: string, retryable = false): never {
    const body: ApiError = { error: { code, message, retryable, details: {} }, meta: this.meta(false) };
    throw ClientError.fromEnvelope(status, body);
  }

  async request<K extends OperationId>(op: K, params: RequestParams = {}): Promise<ApiOperations[K]["response"]> {
    await new Promise((r) => setTimeout(r, this.options.latencyMs));
    if (this.options.failNextRequest) {
      this.options.failNextRequest = false;
      this.emit();
      throw new ClientError({ kind: "network", retryable: true, message: "Simulated network failure (mock). Nothing was saved. Retry sends the same request." });
    }
    this.lastNote = null;
    const def = ENDPOINTS[op];
    if (op === "listDemoUsers") return { data: { users: this.users }, meta: this.meta(false) } as ApiOperations[K]["response"];

    const actor = this.users.find((u) => u.id === params.actorId);
    if (!actor) this.fail(401, "UNAUTHENTICATED", "Select a valid demo user.");
    const stateId = this.stateByCompany[actor.companyId];
    const workspace = fixtures.states[stateId];

    if (op === "getWorkspace") {
      return { data: { ...clone(workspace), actor }, meta: this.meta(false) } as ApiOperations[K]["response"];
    }

    const path: string = def.path.replace(":id", params.id ?? "");
    if (params.id && !JSON.stringify(workspace).includes(`"id":"${params.id}"`)) {
      this.fail(404, "NOT_FOUND", "Resource not found.");
    }

    if (op === "getForecast") {
      const s = fixtures.scenarios.find((x) => x.operationId === op && x.stateId === stateId &&
        canonical(Object.fromEntries(Object.entries(x.request.query ?? {}).map(([k, v]) => [k, String(v)]))) === canonical(params.query ?? {}));
      if (!s) {
        throw new ClientError({ kind: "mock_gap", message: `No approved forecast fixture for state "${stateId}" with these settings. The forecast fixture exists for state "afterPromise" with a 7-day delay.` });
      }
      return clone(s.response.body) as ApiOperations[K]["response"];
    }

    // Writes: role check first (as the server does), then idempotency, then fixture lookup.
    const candidates = fixtures.scenarios.filter((s) => s.operationId === op && s.stateId === stateId && s.request.path === path);
    if (!(def.roles as readonly string[]).includes(actor.role)) {
      const recorded = candidates.find((s) => s.request.headers["X-Demo-User"] === actor.id && s.response.status === 403);
      if (recorded) throw ClientError.fromEnvelope(403, recorded.response.body as ApiError);
      this.fail(403, "FORBIDDEN", "Your demo role cannot perform this action.");
    }
    if (!params.idempotencyKey) this.fail(422, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key.");

    const requestShape = params.multipart
      ? { fields: params.multipart.fields, file: await this.describeFile(params.multipart.file) }
      : params.body;
    const fingerprint = `${def.method}\n${path}\n${canonical(requestShape)}`;
    const idemKey = `${actor.companyId}|${actor.id}|${params.idempotencyKey}`;
    const stored = this.idempotency.get(idemKey);
    if (stored) {
      if (stored.fingerprint !== fingerprint) this.fail(409, "IDEMPOTENCY_CONFLICT", "This key belongs to another request.");
      const body = clone(stored.body) as { meta: ApiMeta };
      body.meta = { ...body.meta, idempotencyReplayed: true };
      return body as ApiOperations[K]["response"];
    }

    const byActor = candidates.filter((s) => s.request.headers["X-Demo-User"] === actor.id);
    const pool = byActor.length ? byActor : candidates;
    const exact = pool.filter((s) => this.sameRequest(s, params, requestShape, false));
    const loose = pool.filter((s) => this.sameRequest(s, params, requestShape, true));
    const chosen = this.pick(op, exact) ?? this.pick(op, loose);
    if (!chosen) {
      throw new ClientError({
        kind: "mock_gap",
        message: candidates.length
          ? `Mock only has approved fixtures for this step with the recorded values (state "${stateId}"). Use the prefilled values or the demo scenario runner.`
          : `No approved fixture covers ${op} from state "${stateId}". The live backend will decide this request.`,
      });
    }
    if (!exact.includes(chosen)) {
      this.lastNote = { scenarioId: chosen.id, message: "Mock returned the approved fixture result; your edited free text is not stored in mock mode." };
    }
    const { status, body } = chosen.response;
    if (status >= 400) throw ClientError.fromEnvelope(status, body as ApiError);
    this.idempotency.set(idemKey, { fingerprint, status, body, nextStateId: chosen.nextStateId });
    this.stateByCompany[actor.companyId] = chosen.nextStateId;
    this.emit();
    return clone(body) as ApiOperations[K]["response"];
  }

  private pick(op: OperationId, list: FixtureScenario[]): FixtureScenario | undefined {
    if (list.length <= 1) return list[0];
    if (op === "createReply") {
      const ai = list.find((s) => s.id === "reply_ai_unavailable");
      const normal = list.find((s) => s.id !== "reply_ai_unavailable");
      return this.options.aiUnavailable ? ai ?? normal : normal ?? ai;
    }
    // Prefer the success fixture when several error drills share the same request.
    return list.find((s) => s.response.status < 400) ?? list[0];
  }

  private async describeFile(file: File) {
    const text = file.type === "text/csv" || file.name.endsWith(".csv") ? await file.text() : null;
    const fixture = text !== null ? fixtures.textFixtures.find((t) => t.text === text)?.id ?? null : null;
    return { name: file.name, type: file.type, size: file.size, csvFixtureId: fixture };
  }

  private sameRequest(s: FixtureRequestHolder, params: RequestParams, shape: unknown, loose: boolean): boolean {
    if (s.request.multipart) {
      if (!params.multipart) return false;
      if (canonical(s.request.multipart.fields) !== canonical(params.multipart.fields)) return false;
      const f = (shape as { file: { csvFixtureId: string | null; type: string } }).file;
      const want = s.request.multipart.file;
      if (want.mimeType === "text/csv") return f.csvFixtureId === want.fixtureId;
      return f.type === want.mimeType || /^image\//.test(f.type);
    }
    const strip = (v: unknown) => {
      if (!loose || !v || typeof v !== "object") return v;
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !FREE_TEXT_KEYS.has(k)));
    };
    return canonical(strip(s.request.body)) === canonical(strip(params.body));
  }
}

type FixtureRequestHolder = Pick<FixtureScenario, "request">;

export const STATE_LABELS: Record<string, string> = {
  before: "Start: invoice issued, RM18,000 outstanding",
  milestoneCompleted: "Milestone completed",
  invoiceDraft: "Invoice draft awaiting Owner",
  invoiceApproved: "Second invoice approved",
  invoiceRejected: "Invoice draft rejected",
  reminderDraft: "Reminder drafted",
  reminderSent: "Reminder sent (simulated)",
  replyReady: "Reply \"Dah bayar boss\" extracted",
  aiUnavailable: "Reply saved, AI unavailable",
  unclearReply: "Unclear reply needs review",
  correctedReply: "Reply corrected by Finance",
  proofReady: "Payment screenshot uploaded",
  lowConfidence: "Low-confidence screenshot",
  manualCorrected: "Screenshot fields corrected",
  lowMatched: "Check result: needs review (low confidence)",
  matchedPartial: "Check result: partial, awaiting Finance",
  afterPartial: "Partial payment recorded",
  duplicateMatched: "Check result: credit already used",
  promiseReady: "Promise reply extracted",
  afterPromise: "Promise confirmed for the balance",
  fullProof: "Full-amount screenshot uploaded",
  fullMatched: "Check result: confirmed, awaiting Finance",
  fullyPaid: "Invoice fully paid",
  ambiguous: "Two bank credits share a reference",
  ambiguousMatched: "Check result: multiple candidates",
  amountMismatch: "Screenshot amount differs from bank",
  amountMismatchMatched: "Check result: amount mismatch",
  noBankCredit: "No bank credit imported yet",
  noBankCreditMatched: "Check result: not in bank yet",
  bankImported: "New bank credit imported",
  rantau: "Rantau IT: invoice issued",
};
