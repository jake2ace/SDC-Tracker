import { createRequire } from "node:module";
import { createWorker, OEM } from "tesseract.js";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const { version } = require("tesseract.js/package.json");

// Raw evidence exists only in memory. All models come from pinned npm dependencies.
process.once("message", async ({ bytes, languages, modelDirectory }) => {
  let worker;
  try {
    worker = await createWorker(languages.join("+"), OEM.LSTM_ONLY, {
      langPath: modelDirectory, cacheMethod: "none", gzip: true, logger: () => {},
      errorHandler: () => process.send?.({ error: "OCR_FAILED" }, () => process.exit(1)),
    });
    const pixels = await sharp(Buffer.from(bytes), { failOn: "warning", limitInputPixels: 20_000_000 })
      .rotate().flatten({ background: "#ffffff" }).png().toBuffer();
    const { data } = await worker.recognize(pixels);
    await worker.terminate();
    worker = undefined;
    process.send?.({ text: data.text, engine: "tesseract.js-local", version });
  } catch {
    if (worker) await worker.terminate().catch(() => {});
    process.send?.({ error: "OCR_FAILED" });
  } finally {
    process.disconnect();
  }
});
