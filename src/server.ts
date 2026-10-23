import { resolve } from "node:path";
import { createApp } from "./app.ts";

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");
const host = process.env.HOST ?? "127.0.0.1";
const app = await createApp({ dbPath: resolve(process.env.DB_PATH ?? ".local/proof-to-cash.db") });
app.server.listen(port, host, () => console.log(`Proof-to-Cash demo API listening on http://${host}:${port}`));
app.server.on("error", () => { console.error("Could not start the API listener."); process.exitCode = 1; void app.close(); });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  void app.close().then(() => process.exit(0), () => process.exit(1));
});
