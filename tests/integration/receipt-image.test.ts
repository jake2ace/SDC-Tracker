import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { AppError } from "../../src/errors.ts";
import { createLocalOcrProvider, MAX_RECEIPT_BYTES, validateReceiptImage } from "../../src/receipt-image.ts";

const receiptSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600">
  <rect width="900" height="600" fill="white"/>
  <g font-family="Arial, sans-serif" font-size="42" fill="black">
    <text x="50" y="100">SYNTHETIC DEMO</text>
    <text x="50" y="210">Amount: MYR 123.45</text>
    <text x="50" y="320">Reference: ABC123456</text>
    <text x="50" y="430">Date: 2026-10-22</text>
  </g>
</svg>`);

test("receipt decoder checks real PNG, JPEG and WebP pixels and original evidence hashes", async () => {
  for (const format of ["png", "jpeg", "webp"] as const) {
    const bytes = await sharp(receiptSvg).toFormat(format).toBuffer();
    const image = await validateReceiptImage(bytes);
    assert.equal(image.mimeType, `image/${format}`);
    assert.equal(image.width, 900);
    assert.equal(image.height, 600);
    assert.equal(image.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.deepEqual(image.bytes, bytes);
    assert.notEqual(image.bytes, bytes);
  }
});

test("receipt decoder rejects unsupported, truncated, animated and oversized inputs", async () => {
  const png = await sharp(receiptSvg).png().toBuffer();
  const jpeg = await sharp(receiptSvg).jpeg().toBuffer();
  const huge = await sharp({ create: { width: 5000, height: 4001, channels: 3, background: "white" } }).png().toBuffer();
  const apngChunk = Buffer.alloc(20);
  apngChunk.writeUInt32BE(8, 0);
  apngChunk.write("acTL", 4);
  apngChunk.writeUInt32BE(2, 8);
  const apng = Buffer.concat([png.subarray(0, 33), apngChunk, png.subarray(33)]);
  for (const [bytes, status] of [
    [receiptSvg, 415], [Buffer.from("not an image"), 415], [png.subarray(0, 40), 422],
    [jpeg.subarray(0, jpeg.length - 100), 422], [apng, 422],
    [Buffer.alloc(MAX_RECEIPT_BYTES + 1), 413], [huge, 413],
  ] as const) {
    await assert.rejects(validateReceiptImage(bytes), error => error instanceof AppError && error.status === status);
  }
});

test("local OCR reads image pixels using bundled models and enforces its timeout", async () => {
  const bytes = await sharp(receiptSvg).webp().toBuffer();
  const image = await validateReceiptImage(bytes);
  const output = await createLocalOcrProvider()(image);
  assert.equal(output.engine, "tesseract.js-local");
  assert.equal(output.version, "7.0.0");
  assert.match(output.text, /123\.45/);
  assert.match(output.text, /ABC123456/);
  await assert.rejects(createLocalOcrProvider({ timeoutMs: 1 })(image), /timed out/);
});
