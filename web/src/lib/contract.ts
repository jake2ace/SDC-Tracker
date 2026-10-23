// Single import point for the frozen contract. Pages never declare their own DTOs.
export * from "../../../contracts/domain";
export * from "../../../contracts/api";
export type { ApiOperations, Workspace, ApiError, ApiMeta } from "../../../contracts/api";
