import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { AppError } from "./errors.ts";

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const MAX_RECEIPT_PIXELS = 20_000_000;

export interface ValidatedReceiptImage {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  sha256: string;
}

function invalidImage(message = "The receipt must be a complete, decodable image."): AppError {
  return new AppError(422, "VALIDATION_ERROR", message, {
    fieldErrors: [{ field: "file", code: "INVALID_IMAGE", message }],
  });
}

function formatOf(bytes: Buffer): "png" | "jpeg" | "webp" {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Only PNG, JPEG and WebP receipt images are supported.");
}

// Some decoders expose only APNG's first frame, so inspect its actual chunks too.
function isAnimatedPng(bytes: Buffer): boolean {
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) throw invalidImage();
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL") return true;
    if (type === "IEND") return false;
    offset += length + 12;
  }
  throw invalidImage();
}

/** Validate the original evidence bytes, not a filename or a client-supplied MIME type. */
export async function validateReceiptImage(input: Uint8Array): Promise<ValidatedReceiptImage> {
  if (input.byteLength > MAX_RECEIPT_BYTES) {
    throw new AppError(413, "PAYLOAD_TOO_LARGE", "Receipt images must be at most 5 MiB.");
  }
  const bytes = Buffer.from(input);
  const format = formatOf(bytes);
  try {
    if (format === "png" && isAnimatedPng(bytes)) throw invalidImage("Animated receipt images are not supported.");
    const decoder = sharp(bytes, { failOn: "warning", limitInputPixels: MAX_RECEIPT_PIXELS });
    const metadata = await decoder.metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height) throw invalidImage();
    if (metadata.width * metadata.height > MAX_RECEIPT_PIXELS) {
      throw new AppError(413, "PAYLOAD_TOO_LARGE", "Receipt images must be at most 20 megapixels.");
    }
    if ((metadata.pages ?? 1) !== 1) throw invalidImage("Animated receipt images are not supported.");
    // metadata() alone accepts several truncated formats. Decode every pixel before storing evidence.
    await decoder.timeout({ seconds: 10 }).removeAlpha().raw().toBuffer();
    return {
      bytes, mimeType: `image/${format}`, width: metadata.width, height: metadata.height,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      throw new AppError(413, "PAYLOAD_TOO_LARGE", "Receipt images must be at most 20 megapixels.");
    }
    throw invalidImage();
  }
}

export interface OcrResult { text: string; engine: string; version: string; }
export type OcrProvider = (image: ValidatedReceiptImage) => Promise<OcrResult>;
export interface LocalOcrConfig {
  timeoutMs?: number;
  languages?: ("eng" | "chi_sim")[];
}

/** Each local OCR job has its own process so timeout also stops workers still initializing. */
export function createLocalOcrProvider(config: LocalOcrConfig = {}): OcrProvider {
  const timeoutMs = config.timeoutMs ?? 30_000;
  const languages = config.languages ?? ["eng", "chi_sim"];
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error("OCR timeout must be between 1 and 120000 milliseconds.");
  }
  if (!languages.length || languages.some(language => !["eng", "chi_sim"].includes(language))) {
    throw new Error("Only bundled eng and chi_sim OCR languages are available.");
  }
  return image => new Promise((resolve, reject) => {
    const modelDirectory = mkdtempSync(join(tmpdir(), "receipt-ocr-models-"));
    try {
      const require = createRequire(import.meta.url);
      for (const code of new Set(languages)) {
        const { langPath } = require(`@tesseract.js-data/${code}`) as { langPath: string };
        symlinkSync(join(langPath, `${code}.traineddata.gz`), join(modelDirectory, `${code}.traineddata.gz`));
      }
    } catch {
      rmSync(modelDirectory, { recursive: true, force: true });
      reject(new Error("Bundled OCR language data is unavailable."));
      return;
    }
    const child = fork(new URL("./receipt-ocr-worker.mjs", import.meta.url), [], {
      execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "advanced",
    });
    let settled = false;
    const finish = (result?: OcrResult, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      rmSync(modelDirectory, { recursive: true, force: true });
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => finish(undefined, new Error("Local OCR timed out.")), timeoutMs);
    child.once("error", () => finish(undefined, new Error("Local OCR could not start.")));
    child.once("exit", () => finish(undefined, new Error("Local OCR stopped before producing text.")));
    child.once("message", (message: unknown) => {
      const value = message as Partial<OcrResult> | null;
      if (!value || typeof value.text !== "string" || value.text.length > 100_000 ||
          typeof value.engine !== "string" || typeof value.version !== "string") {
        finish(undefined, new Error("Local OCR could not read this image."));
        return;
      }
      finish({ text: value.text, engine: value.engine, version: value.version });
    });
    child.send({ bytes: Buffer.from(image.bytes), languages, modelDirectory }, error => {
      if (error) finish(undefined, new Error("Local OCR could not receive this image."));
    });
  });
}
