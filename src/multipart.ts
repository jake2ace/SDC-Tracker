import type { IncomingMessage } from "node:http";
import { AppError } from "./errors.ts";

export interface BankUpload {
  expectedVersion: number;
  file: { bytes: Uint8Array; mimeType: string; filename: string };
}

export async function readBankUpload(req: IncomingMessage): Promise<BankUpload> {
  const contentType = req.headers["content-type"] ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    req.resume();
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Use multipart/form-data with a CSV file.");
  }
  // Bound the complete envelope as well as the decoded file; retain room for headers.
  const body = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failed = false;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024 + 64 * 1024) {
        if (!failed) reject(new AppError(413, "PAYLOAD_TOO_LARGE", "Upload exceeds the CSV size limit."));
        failed = true; chunks.length = 0;
      } else if (!failed) chunks.push(chunk);
    });
    req.on("end", () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on("error", () => reject(new AppError(422, "VALIDATION_ERROR", "Could not read upload.")));
  });
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(body), { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new AppError(422, "VALIDATION_ERROR", "Malformed multipart upload.");
  }
  const keys: string[] = [];
  form.forEach((_value, key) => keys.push(key));
  if (keys.length !== 2 || !keys.includes("file") || !keys.includes("expectedVersion")) {
    throw new AppError(422, "VALIDATION_ERROR", "Upload requires exactly file and expectedVersion.");
  }
  const file = form.get("file");
  const version = form.get("expectedVersion");
  if (!(file instanceof Blob) || typeof version !== "string" || !/^[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version))) {
    throw new AppError(422, "VALIDATION_ERROR", "Provide one file and a positive integer expectedVersion.");
  }
  if (file.size > 1024 * 1024) throw new AppError(413, "PAYLOAD_TOO_LARGE", "CSV exceeds 1 MiB.");
  return { expectedVersion: Number(version), file: { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type.toLowerCase(), filename: (file as File).name ?? "upload.csv" } };
}
