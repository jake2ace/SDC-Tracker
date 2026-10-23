import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

/** Offline synthetic fixture construction only. Production extraction never imports this file or gold. */
const root = new URL("../", import.meta.url);
const manifestBytes = await readFile(new URL("data/eval/receipts.manifest.json", root));
const goldBytes = await readFile(new URL("data/eval/receipts.gold.json", root));
type Planned = { id: string; companyId: string; layoutId: string; variant: string; plannedImagePath: string };
type Evidence = { bank: string; amountSen: number; reference: string; transferredAt: string; payer: string };
const manifest = JSON.parse(manifestBytes.toString()) as { samples: Planned[] };
const labels = JSON.parse(goldBytes.toString()) as { labels: { id: string; evidence: Evidence }[] };
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const xml = (value: string) => value.replace(/[&<>"']/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
const assets = [];
await mkdir(new URL("data/eval/images/", root), { recursive: true });
for (const [index, sample] of manifest.samples.entries()) {
  const evidence = labels.labels.find(label => label.id === sample.id)?.evidence;
  if (!evidence) throw new Error(`Missing fixture label: ${sample.id}`);
  const amount = `RM ${(evidence.amountSen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const localDate = new Date(Date.parse(evidence.transferredAt) + 8 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
  const dark = sample.variant === "dark";
  const background = dark ? "#17212d" : "#f5f7fa";
  const ink = dark ? "#f8fafc" : "#17212d";
  const muted = dark ? "#d0d6de" : "#475569";
  const accent = dark ? "#29455e" : "#dbeafe";
  const line = (text: string, x: number, y: number, size = 31, weight = "400", color = ink) => `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${xml(text)}</text>`;
  let body = `<rect width="900" height="1200" fill="${background}"/>`;
  if (sample.layoutId === "layout_transfer_slip") {
    body += `<rect x="55" y="60" width="790" height="145" rx="12" fill="${accent}"/>`;
    body += line("TRANSFER RECEIPT", 85, 125, 40, "700") + line("SYNTHETIC DEMO", 85, 174, 25, "700");
    body += line("Transfer amount", 85, 290, 26, "400", muted) + line(amount, 85, 350, 49, "700");
    const rows = [["Bank", evidence.bank], ["Payer", evidence.payer], ["Reference", evidence.reference], ["Transfer date / time (MYT)", localDate]];
    rows.forEach(([label, value], i) => { body += line(label!, 85, 470 + 135 * i, 25, "400", muted) + line(value!, 85, 520 + 135 * i, 31, "700"); });
  } else if (sample.layoutId === "layout_mobile_confirmation") {
    body += `<rect x="110" y="60" width="680" height="1080" rx="36" fill="${accent}"/>`;
    body += line("Payment confirmation", 155, 140, 38, "700") + line("SYNTHETIC DEMO", 155, 200, 26, "700");
    body += line(amount, 155, 305, 48, "700");
    const rows = [["From bank", evidence.bank], ["Payer", evidence.payer], ["Transaction reference", evidence.reference], ["Transferred at (MYT)", localDate]];
    rows.forEach(([label, value], i) => { body += line(label!, 155, 425 + i * 155, 25, "400", muted) + line(value!, 155, 475 + i * 155, 30, "700"); });
  } else if (sample.layoutId === "layout_web_receipt") {
    body += `<rect x="50" y="65" width="800" height="120" fill="${accent}"/>`;
    body += line("ONLINE TRANSFER", 80, 120, 38, "700") + line("SYNTHETIC DEMO", 80, 162, 25, "700");
    body += line("Transaction details", 80, 280, 35, "700");
    const rows = [["Amount", amount], ["Reference", evidence.reference], ["Payer", evidence.payer], ["Bank", evidence.bank], ["Transfer time (MYT)", localDate]];
    rows.forEach(([label, value], i) => {
      body += `<rect x="65" y="${330 + i * 135}" width="770" height="112" fill="${i % 2 ? background : accent}"/>`;
      body += line(label!, 90, 365 + i * 135, 25, "400", muted) + line(value!, 90, 411 + i * 135, 31, "700");
    });
  } else {
    body += line("TRANSACTION HISTORY", 75, 125, 39, "700") + line("SYNTHETIC DEMO", 75, 178, 25, "700");
    body += `<rect x="60" y="245" width="780" height="670" rx="10" fill="${accent}"/>`;
    const rows = [["Amount", amount], ["Bank", evidence.bank], ["Reference", evidence.reference], ["Payer", evidence.payer], ["Date / time (MYT)", localDate]];
    rows.forEach(([label, value], i) => { body += line(label!, 90, 295 + i * 125, 24, "400", muted) + line(value!, 90, 338 + i * 125, 31, "700"); });
  }
  body += line("Invented demonstration only - no money moved", 80, 1088, 23, "400", muted);
  if (sample.variant === "noisy") {
    // Deterministic low-opacity specks: simulated scanning noise, not hidden text.
    for (let n = 0; n < 700; n++) {
      const x = (n * 137 + index * 29) % 900;
      const y = (n * 293 + index * 47) % 1200;
      body += `<circle cx="${x}" cy="${y}" r="1" fill="${ink}" opacity="0.11"/>`;
    }
  }
  let render = sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">${body}</svg>`));
  if (sample.variant === "cropped") render = render.extract({ left: 30, top: 30, width: 840, height: 1140 });
  const bytes = await render.png().toBuffer();
  const metadata = await sharp(bytes).metadata();
  await writeFile(new URL(`data/eval/${sample.plannedImagePath}`, root), bytes);
  assets.push({ id: sample.id, companyId: sample.companyId, layoutId: sample.layoutId, variant: sample.variant, imagePath: sample.plannedImagePath,
    mimeType: "image/png", sha256: sha256(bytes), byteLength: bytes.length, width: metadata.width, height: metadata.height, synthetic: true });
}
await writeFile(new URL("data/eval/receipts.generated.json", root), JSON.stringify({
  metadata: { synthetic: true, generatedAt: new Date().toISOString(), count: assets.length, generator: "scripts/generate-receipts.ts", generatorSha256: sha256(await readFile(new URL(import.meta.url))),
    sourceManifestSha256: sha256(manifestBytes), goldSha256: sha256(goldBytes), renderer: `sharp ${sharp.versions.sharp}; libvips ${sharp.versions.vips}`,
    note: "Offline construction uses frozen synthetic gold. Runtime extraction reads only rendered image bytes; gold is loaded separately for scoring. The original planned manifest and gold remain unchanged." }, samples: assets,
}, null, 2) + "\n");
console.log(JSON.stringify({ count: assets.length, manifest: "data/eval/receipts.generated.json", layouts: 4, variants: ["normal", "cropped", "noisy", "dark"] }));
