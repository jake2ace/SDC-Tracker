import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AppError } from "./errors.ts";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2",
};

/** Serve only a startup snapshot of the public build; never resolve request paths on disk. */
export function createFrontendHandler(directory: string) {
  const files = new Map<string, { bytes: Buffer; contentType: string }>();
  function load(folder: string, prefix = "") {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const file = join(folder, entry.name), path = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) load(file, path);
      else if (entry.isFile() && contentTypes[extname(entry.name)]) {
        files.set(path, { bytes: readFileSync(file), contentType: contentTypes[extname(entry.name)] });
      }
    }
  }
  load(directory);
  const index = files.get("/index.html");
  if (!index) throw new Error("Frontend build is missing index.html. Run npm run build before starting production.");

  return (req: IncomingMessage, res: ServerResponse, pathname: string): boolean => {
    if (pathname === "/api" || pathname.startsWith("/api/") || pathname === "/health") return false;
    const missing = () => new AppError(404, "NOT_FOUND", "Page or asset not found.");
    if (req.method !== "GET" && req.method !== "HEAD") throw missing();
    let path: string;
    try { path = decodeURIComponent((req.url ?? "/").split("?", 1)[0]); }
    catch { throw missing(); }
    if (!path.startsWith("/") || /[\\\u0000-\u001f]/u.test(path) || path.split("/").some(part => part.startsWith("."))) throw missing();
    const asset = files.get(path);
    // Missing assets must stay 404; only extensionless page routes use the SPA shell.
    const file = asset ?? (!extname(path) && !path.startsWith("/assets/") ? index : undefined);
    if (!file) throw missing();
    res.writeHead(200, { "Content-Type": file.contentType, "Content-Length": file.bytes.byteLength,
      "Cache-Control": file === index ? "no-cache" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
    res.end(req.method === "HEAD" ? undefined : file.bytes);
    return true;
  };
}
