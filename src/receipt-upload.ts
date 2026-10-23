import type { IncomingMessage } from "node:http";
import { AppError } from "./errors.ts";

export interface ReceiptUpload {
  expectedVersion: number;
  replyId?: string;
  expectedReplyVersion?: number;
  file: { bytes: Uint8Array; mimeType: string; filename: string };
}

/** Parse only the bounded envelope here; actual image decoding happens after replay checks. */
export async function readReceiptUpload(req: IncomingMessage): Promise<ReceiptUpload> {
  const contentType = req.headers["content-type"] ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    req.resume();
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Use multipart/form-data with an image.");
  }
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let failed = false;
    req.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > 5 * 1024 * 1024 + 64 * 1024) {
        if (!failed) reject(new AppError(413, "PAYLOAD_TOO_LARGE", "Receipt upload exceeds 5 MiB."));
        failed = true; chunks.length = 0;
      } else if (!failed) chunks.push(chunk);
    });
    req.on("end", () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on("error", () => reject(new AppError(422, "VALIDATION_ERROR", "Could not read receipt upload.")));
  });
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": contentType } }).formData();
  } catch { throw new AppError(422, "VALIDATION_ERROR", "Malformed multipart upload."); }
  const keys: string[] = [];
  form.forEach((_value, key) => keys.push(key));
  if (new Set(keys).size !== keys.length || keys.some(key => !["file", "expectedVersion", "replyId", "expectedReplyVersion"].includes(key))) {
    throw new AppError(422, "VALIDATION_ERROR", "Duplicate or unexpected upload field.");
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new AppError(422, "VALIDATION_ERROR", "An image file is required.");
  if (file.size > 5 * 1024 * 1024) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Receipt image exceeds 5 MiB.");
  const version = (key: string) => {
    const value = form.get(key);
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new AppError(422, "VALIDATION_ERROR", `${key} must be a positive integer.`);
    }
    return Number(value);
  };
  const result: ReceiptUpload = { expectedVersion: version("expectedVersion"), file: {
    bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type.toLowerCase(), filename: (file as File).name ?? "receipt",
  } };
  if (form.has("replyId") !== form.has("expectedReplyVersion")) {
    throw new AppError(422, "VALIDATION_ERROR", "replyId and expectedReplyVersion must be supplied together.");
  }
  if (form.has("replyId")) {
    const replyId = form.get("replyId");
    if (typeof replyId !== "string" || !replyId.trim() || replyId.length > 200) {
      throw new AppError(422, "VALIDATION_ERROR", "Invalid replyId.");
    }
    result.replyId = replyId;
    result.expectedReplyVersion = version("expectedReplyVersion");
  }
  return result;
}
