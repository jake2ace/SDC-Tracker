import type { ApiError, ApiOperations, ErrorCode, Id } from "../contract";

export type OperationId = keyof ApiOperations;
export type DataSource = "mock" | "api";

/** Multipart body as the UI builds it. The HTTP client turns it into FormData. */
export interface MultipartBody {
  fields: Record<string, string>;
  file: File;
}

export interface RequestParams {
  actorId?: Id;
  /** Path parameter (:id). */
  id?: Id;
  body?: unknown;
  multipart?: MultipartBody;
  query?: Record<string, string>;
  idempotencyKey?: string;
}

export type ErrorKind =
  | "api"          // contract error envelope from the server (or mock fixture)
  | "network"      // request never got a response
  | "bad_response" // response did not follow the contract envelope
  | "planned"      // endpoint is still planned in contract v1.0.0
  | "mock_gap";    // mock has no approved fixture for this exact request

export class ClientError extends Error {
  readonly kind: ErrorKind;
  readonly status: number | null;
  readonly code: ErrorCode | null;
  readonly retryable: boolean;
  readonly details: ApiError["error"]["details"];
  readonly requestId: string | null;

  constructor(init: {
    kind: ErrorKind; message: string; status?: number | null; code?: ErrorCode | null;
    retryable?: boolean; details?: ApiError["error"]["details"]; requestId?: string | null;
  }) {
    super(init.message);
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.retryable = init.retryable ?? false;
    this.details = init.details ?? {};
    this.requestId = init.requestId ?? null;
  }

  static fromEnvelope(status: number, body: ApiError): ClientError {
    return new ClientError({
      kind: "api", status, code: body.error.code, message: body.error.message,
      retryable: body.error.retryable, details: body.error.details, requestId: body.meta?.requestId ?? null,
    });
  }
}

/** Both mock and api implement exactly this. Pages only see the contract DTOs. */
export interface DataClient {
  readonly source: DataSource;
  request<K extends OperationId>(op: K, params?: RequestParams): Promise<ApiOperations[K]["response"]>;
  /** True when this client can execute the operation (api: implemented endpoints only). */
  supports(op: OperationId): boolean;
}
