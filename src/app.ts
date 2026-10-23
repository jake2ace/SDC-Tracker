import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { CONTRACT_VERSION, DEMO_CLOCK, ENDPOINTS } from "../contracts/api.ts";
import type { DemoUser, Receipt } from "../contracts/domain.ts";
import { Store, type EntityKind } from "./store.ts";
import { AppError } from "./errors.ts";
import { executeOperation, prepareReminder, type Context, type Operation } from "./operations.ts";
import { createReminderProvider, type ReminderProvider } from "./reminder-provider.ts";
import { readBankUpload, type BankUpload } from "./multipart.ts";
import { importBankStatement } from "./bank-import.ts";
import { runReceiptMatch } from "./reconciliation-match.ts";
import { readReceiptUpload, type ReceiptUpload } from "./receipt-upload.ts";
import { createExtractionProvider, type ExtractionProvider } from "./extraction-provider.ts";
import { createLocalOcrProvider, type OcrProvider } from "./receipt-image.ts";
import { prepareReply, createReply, prepareReceipt, saveReceipt, correctReply, correctReceipt } from "./evidence-operations.ts";
import { approvePayment, confirmPromise } from "./reconciliation.ts";
import { getForecast } from "./forecast-query.ts";

interface AppOptions {
  dbPath: string;
  clock?: string;
  reminderProvider?: ReminderProvider;
  frontendOrigin?: string;
  extractionProvider?: ExtractionProvider;
  ocrProvider?: OcrProvider;
}

type WriteOperation = Operation | "importBankStatement" | "runMatch" | "createReply" | "correctReply" | "uploadReceipt" | "correctReceipt" | "approvePayment" | "confirmPromise";
const writes: { operation: WriteOperation; route: RegExp; kind: EntityKind | "company" }[] = [
  { operation: "completeMilestone", route: /^\/api\/milestones\/([^/]+)\/complete$/, kind: "milestones" },
  { operation: "createInvoiceDraft", route: /^\/api\/milestones\/([^/]+)\/invoice-draft$/, kind: "milestones" },
  { operation: "decideInvoice", route: /^\/api\/invoices\/([^/]+)\/decision$/, kind: "invoices" },
  { operation: "generateReminder", route: /^\/api\/invoices\/([^/]+)\/reminders$/, kind: "invoices" },
  { operation: "sendReminder", route: /^\/api\/reminders\/([^/]+)\/send$/, kind: "reminders" },
  { operation: "importBankStatement", route: /^\/api\/bank-statements$/, kind: "company" },
  { operation: "runMatch", route: /^\/api\/receipts\/([^/]+)\/match$/, kind: "receipts" },
  { operation: "createReply", route: /^\/api\/invoices\/([^/]+)\/replies$/, kind: "invoices" },
  { operation: "correctReply", route: /^\/api\/replies\/([^/]+)\/extraction$/, kind: "replies" },
  { operation: "uploadReceipt", route: /^\/api\/invoices\/([^/]+)\/receipts$/, kind: "invoices" },
  { operation: "correctReceipt", route: /^\/api\/receipts\/([^/]+)\/evidence$/, kind: "receipts" },
  { operation: "approvePayment", route: /^\/api\/matches\/([^/]+)\/approve-payment$/, kind: "matches" },
  { operation: "confirmPromise", route: /^\/api\/replies\/([^/]+)\/confirm-promise$/, kind: "replies" },
];

// JSON values parsed by this service use ECMAScript number/string serialization;
// sorted UTF-16 object keys give RFC 8785 canonical JSON for the accepted DTOs.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new AppError(422, "VALIDATION_ERROR", "Invalid JSON number.");
  return JSON.stringify(value);
}

function bodyFrom(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) {
    req.resume();
    return Promise.reject(new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Use application/json."));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16 * 1024) {
        if (!failed) reject(new AppError(413, "PAYLOAD_TOO_LARGE", "JSON body exceeds 16 KiB."));
        failed = true;
        chunks.length = 0;
      } else if (!failed) chunks.push(chunk);
    });
    req.on("end", () => {
      if (failed) return;
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("object required");
        resolve(value);
      } catch { reject(new AppError(422, "VALIDATION_ERROR", "Body must be a JSON object.")); }
    });
    req.on("error", () => reject(new AppError(422, "VALIDATION_ERROR", "Could not read request body.")));
  });
}

export async function createApp(options: AppOptions) {
  const store = new Store(options.dbPath);
  const now = options.clock ?? DEMO_CLOCK;
  if (!Number.isFinite(Date.parse(now)) || !now.endsWith("Z")) {
    store.close();
    throw new Error("The demo clock must be a UTC timestamp.");
  }
  const provider = options.reminderProvider ?? createReminderProvider({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
    model: process.env.DEEPSEEK_MODEL,
    timeoutMs: Number(process.env.DEEPSEEK_TIMEOUT_MS ?? 10000),
  });
  const pending = new Set<string>();
  const extractionProvider = options.extractionProvider ?? createExtractionProvider({
    apiKey: process.env.DEEPSEEK_API_KEY, baseUrl: process.env.DEEPSEEK_BASE_URL,
    model: process.env.DEEPSEEK_MODEL, timeoutMs: Number(process.env.DEEPSEEK_TIMEOUT_MS ?? 10000),
  });
  const ocrProvider = options.ocrProvider ?? createLocalOcrProvider();
  const frontendOrigin = options.frontendOrigin ?? process.env.FRONTEND_ORIGIN;
  const server = createServer((req, res) => { void handle(req, res); });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const requestId = randomUUID();
    let actor: DemoUser | undefined;
    let ownedPending: string | undefined;
    let operation = "request";
    let ownEntityId = "request";
    const meta = (replayed = false) => ({ requestId, contractVersion: CONTRACT_VERSION, mode: "demo" as const, asOf: now, idempotencyReplayed: replayed });
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(JSON.stringify(body));
    };
    const success = (status: number, data: unknown, replayed = false) => json(status, { data, meta: meta(replayed) });
    try {
      const origin = req.headers.origin;
      if (origin && origin === frontendOrigin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Demo-User, Idempotency-Key");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
      }
      if (req.method === "OPTIONS") {
        if (!origin || origin !== frontendOrigin) throw new AppError(403, "FORBIDDEN", "Origin is not enabled.");
        res.writeHead(204); res.end(); return;
      }
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      if (url.search && !(req.method === "GET" && path === ENDPOINTS.getForecast.path)) {
        throw new AppError(422, "VALIDATION_ERROR", "This endpoint accepts no query parameters.");
      }
      if (req.method === "GET" && path === "/health") {
        store.listUsers();
        success(200, { status: "ok", service: "proof-to-cash", stage: "reconciliation", database: "ready" }); return;
      }
      if (req.method === "GET" && path === ENDPOINTS.listDemoUsers.path) {
        success(200, { users: store.listUsers() }); return;
      }
      const actorId = req.headers["x-demo-user"];
      actor = typeof actorId === "string" ? store.getUser(actorId) : undefined;
      if (!actor) throw new AppError(401, "UNAUTHENTICATED", "Select a valid demo user.");
      if (req.method === "GET" && path === ENDPOINTS.getWorkspace.path) {
        success(200, store.transaction(() => store.getWorkspace(actor!))); return;
      }
      if (req.method === "GET" && path === ENDPOINTS.getForecast.path) {
        success(200, getForecast({ store, actor, now, requestId }, url.searchParams)); return;
      }
      const imageRoute = /^\/api\/receipts\/([^/]+)\/image$/.exec(path);
      if (req.method === "GET" && imageRoute) {
        const receipt = store.get<Receipt>("receipts", imageRoute[1], actor.companyId);
        const image = receipt && store.getReceiptArtifact(receipt.id, actor.companyId);
        if (!image) throw new AppError(404, "NOT_FOUND", "Image not found.");
        res.writeHead(200, { "Content-Type": image.mimeType, "Content-Length": image.bytes.byteLength,
          "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" });
        res.end(image.bytes); return;
      }
      const route = writes.find(x => ENDPOINTS[x.operation].method === req.method && x.route.test(path));
      if (!route) throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
      operation = route.operation;
      const id = route.kind === "company" ? actor.companyId : route.route.exec(path)![1];
      // Resolve within this company before permissions or idempotency replay.
      if (!(route.kind === "company" ? store.getCompany(id) : store.get(route.kind, id, actor.companyId))) throw new AppError(404, "NOT_FOUND", "Resource not found.");
      ownEntityId = id;
      const endpoint = ENDPOINTS[route.operation];
      if (!(endpoint.roles as readonly string[]).includes(actor.role)) throw new AppError(403, "FORBIDDEN", "Your demo role cannot perform this action.");
      const key = req.headers["idempotency-key"];
      if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
        throw new AppError(422, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key of 8–128 allowed characters.");
      }
      const body = route.operation === "importBankStatement" ? await readBankUpload(req)
        : route.operation === "uploadReceipt" ? await readReceiptUpload(req) : await bodyFrom(req);
      const upload = route.operation === "importBankStatement" ? body as BankUpload : undefined;
      const receiptUpload = route.operation === "uploadReceipt" ? body as ReceiptUpload : undefined;
      const fileUpload = upload ?? receiptUpload;
      const canonicalBody = fileUpload ? canonical({
        expectedVersion: String(fileUpload.expectedVersion), mimeType: fileUpload.file.mimeType,
        fileSha256: createHash("sha256").update(fileUpload.file.bytes).digest("hex"),
        ...(receiptUpload?.replyId ? { replyId: receiptUpload.replyId, expectedReplyVersion: String(receiptUpload.expectedReplyVersion) } : {}),
      }) : canonical(body);
      const fingerprint = createHash("sha256").update(`${req.method}\n${path}\n${canonicalBody}`).digest("hex");
      const stored = store.getIdempotency(actor.companyId, actor.id, key);
      if (stored) {
        if (stored.fingerprint !== fingerprint) throw new AppError(409, "IDEMPOTENCY_CONFLICT", "This key belongs to another request.");
        success(stored.status, stored.data, true); return;
      }
      const pendingKey = JSON.stringify([actor.companyId, actor.id, key]);
      if (pending.has(pendingKey)) throw new AppError(409, "IDEMPOTENCY_IN_PROGRESS", "This request is still running.", {}, true);
      pending.add(pendingKey); ownedPending = pendingKey;
      const ctx: Context = { store, actor, now, requestId };
      const prepared = route.operation === "generateReminder" ? await prepareReminder(ctx, id, body, provider) : undefined;
      const preparedReply = route.operation === "createReply" ? await prepareReply(ctx, id, body, extractionProvider) : undefined;
      const preparedReceipt = receiptUpload ? await prepareReceipt(ctx, id, receiptUpload, ocrProvider, extractionProvider) : undefined;
      const result = store.transaction(() => {
        // Another process may have committed while generation was awaiting I/O.
        const cached = store.getIdempotency(actor!.companyId, actor!.id, key);
        if (cached) {
          if (cached.fingerprint !== fingerprint) throw new AppError(409, "IDEMPOTENCY_CONFLICT", "This key belongs to another request.");
          return { status: cached.status, data: cached.data, replayed: true };
        }
        const data = route.operation === "importBankStatement" ? importBankStatement(ctx, upload!)
          : route.operation === "runMatch" ? runReceiptMatch(ctx, id, body)
          : route.operation === "createReply" ? createReply(ctx, id, body, preparedReply!)
          : route.operation === "correctReply" ? correctReply(ctx, id, body)
          : route.operation === "uploadReceipt" ? saveReceipt(ctx, id, receiptUpload!, preparedReceipt!)
          : route.operation === "correctReceipt" ? correctReceipt(ctx, id, body)
          : route.operation === "approvePayment" ? approvePayment(ctx, id, body)
          : route.operation === "confirmPromise" ? confirmPromise(ctx, id, body)
          : executeOperation(ctx, route.operation, id, body, prepared);
        store.saveIdempotency(actor!.companyId, actor!.id, key, fingerprint, endpoint.successStatus, data);
        return { status: endpoint.successStatus, data, replayed: false };
      });
      success(result.status, result.data, result.replayed);
    } catch (error) {
      const failure = error instanceof AppError ? error : new AppError(500, "INTERNAL_ERROR", "The request could not be completed.", {}, true);
      if (actor && req.method !== "GET" && req.method !== "OPTIONS") {
        try {
          store.insert("activityLog", { id: `event_${randomUUID()}`, companyId: actor.companyId, actorId: actor.id,
            action: `${operation}.rejected`, entityType: "request", entityId: ownEntityId, occurredAt: now,
            outcome: "rejected", reasonCode: failure.code, requestId, summary: "Request rejected; business state unchanged." });
        } catch { /* Do not expose SQLite internals or turn an error into success. */ }
      }
      if (!res.headersSent) json(failure.status, { error: { code: failure.code, message: failure.message, retryable: failure.retryable, details: failure.details }, meta: meta() });
      else res.end();
    } finally {
      if (ownedPending) pending.delete(ownedPending);
    }
  }

  return { server, store, close: async () => {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeIdleConnections();
      });
    }
    store.close();
  } };
}
