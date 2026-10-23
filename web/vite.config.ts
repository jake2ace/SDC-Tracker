/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The contracts folder sits next to web/, so Vite must be allowed to read it.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.API_TARGET ?? "http://127.0.0.1:3000";
  return {
    plugins: [react()],
    server: {
      port: 5173,
      fs: { allow: [repoRoot] },
      // Same-origin proxy, so the backend does not need FRONTEND_ORIGIN for local dev.
      proxy: { "/api": { target: apiTarget, changeOrigin: false }, "/health": { target: apiTarget } },
    },
    // Mock mode bundles contracts/fixtures.json (about 320 KB), so the default warning is raised.
    build: { chunkSizeWarningLimit: 900 },
    test: { environment: "node" },
  };
});
