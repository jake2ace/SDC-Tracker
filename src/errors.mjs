export const ERROR_STATUS = Object.freeze({
  VALIDATION_ERROR: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403,
  NOT_FOUND: 404, INVALID_STATE: 409, UPSTREAM_FAILED: 502, AI_UNAVAILABLE: 503
});

export class ApiError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }
}

export function requireCondition(condition, code, message, details) {
  if (!condition) throw new ApiError(code, message, details);
}

export function requireObject(value, allowedKeys) {
  requireCondition(value && typeof value === 'object' && !Array.isArray(value),
    'VALIDATION_ERROR', 'The request body must be an object.');
  requireCondition(Object.keys(value).every(key => allowedKeys.includes(key)),
    'VALIDATION_ERROR', 'The request contains an unknown field.');
}
