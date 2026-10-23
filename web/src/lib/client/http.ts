import { ENDPOINTS, type ApiError, type ApiOperations } from "../contract";
import { ClientError, type DataClient, type OperationId, type RequestParams } from "./types";

function buildPath(op: OperationId, params: RequestParams): string {
  const def = ENDPOINTS[op];
  let path: string = def.path;
  if (path.includes(":id")) {
    if (!params.id) throw new ClientError({ kind: "bad_response", message: `Missing id for ${op}.` });
    path = path.replace(":id", encodeURIComponent(params.id));
  }
  if (params.query) path += `?${new URLSearchParams(params.query).toString()}`;
  return path;
}

/** Real backend client. Only endpoints marked implemented in contracts/api.ts are called. */
export class HttpClient implements DataClient {
  readonly source = "api" as const;
  constructor(private readonly baseUrl = "") {}

  supports(op: OperationId): boolean {
    return ENDPOINTS[op].status === "implemented";
  }

  async request<K extends OperationId>(op: K, params: RequestParams = {}): Promise<ApiOperations[K]["response"]> {
    const def = ENDPOINTS[op];
    if (def.status !== "implemented") {
      throw new ClientError({
        kind: "planned",
        message: "The backend has not implemented this step yet (planned in contract v1.0.0).",
      });
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    if (params.actorId) headers["X-Demo-User"] = params.actorId;
    if (def.method !== "GET") {
      if (!params.idempotencyKey) throw new ClientError({ kind: "bad_response", message: "Write without Idempotency-Key." });
      headers["Idempotency-Key"] = params.idempotencyKey;
    }
    let body: BodyInit | undefined;
    if (params.multipart) {
      const form = new FormData();
      for (const [k, v] of Object.entries(params.multipart.fields)) form.append(k, v);
      form.append("file", params.multipart.file);
      body = form;
    } else if (params.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(params.body);
    }

    let res: Response;
    try {
      res = await fetch(this.baseUrl + buildPath(op, params), { method: def.method, headers, body });
    } catch {
      throw new ClientError({
        kind: "network", retryable: true,
        message: "Could not reach the demo API. Check that the backend is running, then retry.",
      });
    }
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("application/json")) {
      if (res.ok && (def.format as string) === "image") {
        return { contentType: type, body: await res.blob() } as ApiOperations[K]["response"];
      }
      throw new ClientError({ kind: "bad_response", status: res.status, retryable: def.method !== "GET", message: `Unexpected response (${res.status}).` });
    }
    let json: unknown;
    try { json = await res.json(); }
    catch { throw new ClientError({ kind: "bad_response", status: res.status, retryable: true, message: "The response was interrupted or unreadable. Retry the same request." }); }
    if (!res.ok) {
      if (json && typeof json === "object" && "error" in json) throw ClientError.fromEnvelope(res.status, json as ApiError);
      throw new ClientError({ kind: "bad_response", status: res.status, retryable: def.method !== "GET", message: `Request failed (${res.status}).` });
    }
    if (!json || typeof json !== "object" || !("data" in json) || !("meta" in json)) {
      throw new ClientError({ kind: "bad_response", status: res.status, retryable: def.method !== "GET", message: "Response is missing the {data, meta} envelope." });
    }
    return json as ApiOperations[K]["response"];
  }
}
