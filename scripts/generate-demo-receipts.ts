import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import type { BankCredit } from "../contracts/domain.ts";

/** Recording assets only. The frozen evaluation corpus is never read or modified here. */
const root = new URL("../", import.meta.url);
const seedBytes = await readFile(new URL("data/seed/demo-state.json", root));
const seed = JSON.parse(seedBytes.toString()) as { bankCredits: BankCredit[] };
const credit = seed.bankCredits.find(row => row.id === "bank_lumen_001");
if (!credit) throw new Error("The Lumen seed credit is missing.");

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const xml = (value: string) => value.replace(/[&<>"']/gu, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[character]!);
const senderBank = "DEMO SENDER BANK A";
const samples = [
  { id: "lumen-partial", reference: credit.reference, time: "10:30:00", bankCreditExternalId: credit.externalId },
  { id: "lumen-final", reference: "LMN-231026-002", time: "11:00:00", bankCreditExternalId: "LUMEN-DEMO-FINAL-002" },
];
const generated = [];
await mkdir(new URL("data/demo/receipts/", root), { recursive: true });
for (const sample of samples) {
  const amount = `RM ${Math.floor(credit.amountSen / 100).toLocaleString("en-MY")}.${String(credit.amountSen % 100).padStart(2, "0")}`;
  const localTime = `${credit.postedDate} ${sample.time} MYT`;
  const text = (value: string, y: number, size: number, weight = "400", color = "#142c37") =>
    `<text x="80" y="${y}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${xml(value)}</text>`;
  let body = '<rect width="900" height="1180" fill="#f7faf9"/><rect x="45" y="45" width="810" height="145" rx="16" fill="#d8eee7"/>';
  body += text("TRANSFER RECEIPT", 110, 40, "700");
  body += text("SYNTHETIC DEMO", 160, 28, "700");
  body += text("Transfer amount", 280, 26) + text(amount, 340, 52, "700");
  const rows = [["From bank", senderBank], ["Payer", credit.payer], ["Reference", sample.reference], ["Transfer date / time (MYT)", localTime]];
  rows.forEach(([label, value], index) => {
    body += text(label!, 465 + index * 145, 25, "400", "#46636a");
    body += text(value!, 515 + index * 145, 32, "700");
  });
  body += text("Invented demonstration only - no money moved", 1080, 24);
  body += text("Verify against the imported demo bank record", 1122, 23);
  const bytes = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1180">${body}</svg>`)).png().toBuffer();
  const imagePath = `receipts/${sample.id}.png`;
  await writeFile(new URL(`data/demo/${imagePath}`, root), bytes);
  generated.push({
    id: sample.id, imagePath, sha256: sha256(bytes), byteLength: bytes.length, width: 900, height: 1180,
    companyId: credit.companyId, invoiceId: "inv_lumen_001", bankCreditExternalId: sample.bankCreditExternalId,
    evidence: {
      bank: senderBank, amountSen: credit.amountSen, reference: sample.reference, payer: credit.payer,
      transferredAt: new Date(`${credit.postedDate}T${sample.time}+08:00`).toISOString(),
    },
  });
}

const csv = [
  "externalId,postedDate,amountSen,reference,payer,bank",
  [samples[1]!.bankCreditExternalId, credit.postedDate, credit.amountSen, samples[1]!.reference, credit.payer, credit.bank].join(","),
  "",
].join("\n");
await writeFile(new URL("data/demo/bank-lumen-final.csv", root), csv);
await writeFile(new URL("data/demo/receipts.generated.json", root), JSON.stringify({
  synthetic: true, purpose: "Seed-aligned recording assets; not part of the frozen 40-image evaluation.",
  generator: "scripts/generate-demo-receipts.ts", generatorSha256: sha256(await readFile(new URL(import.meta.url))),
  sourceSeedSha256: sha256(seedBytes), renderer: `sharp ${sharp.versions.sharp}; libvips ${sharp.versions.vips}`,
  note: "Rendering is deterministic for the same seed, generator and renderer/font environment. Receipt sender bank and CSV receiving bank are different transfer sides. No OCR/model accuracy is asserted by generation.",
  samples: generated,
}, null, 2) + "\n");
console.log(JSON.stringify({ receipts: generated.length, directory: "data/demo", finalCreditCsv: "data/demo/bank-lumen-final.csv" }));
