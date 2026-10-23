import { resolve } from "node:path";
import { Store } from "../src/store.ts";

const store = new Store(resolve(process.env.DB_PATH ?? ".local/proof-to-cash.db"));
try {
  if (process.argv.includes("--reset")) store.reset();
  console.log(process.argv.includes("--reset") ? "Local demo data reset to the synthetic seed." : "Local demo database ready; existing data preserved.");
} finally { store.close(); }
