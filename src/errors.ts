import type { ApiError, ErrorCode } from "../contracts/api.ts";

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: ApiError["error"]["details"];
  readonly retryable: boolean;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    details: ApiError["error"]["details"] = {},
    retryable = false,
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}
