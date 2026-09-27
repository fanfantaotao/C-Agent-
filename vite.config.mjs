import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wbBridge from "./wb-bridge/vite-plugin.mjs";
import wbJsxSource from "./wb-bridge/jsx-source-plugin.mjs";

/**
 * `serve` (npm run dev) adds the wb-bridge — see wb-bridge/:
 *   - every host element is compiled with `data-wb-src="src/Workspace.jsx:182:7"`,
 *     so any DOM node maps back to the exact source line that rendered it;
 *   - the dev server exposes /__wb__/api, which lets an AI agent read the user's
 *     click-to-edit requests and drive/highlight the page back.
 *
 * `build` is untouched, so the single-file export keeps shipping without any of it.
 */
export default defineConfig(({ command }) => {
  const dev = command === "serve";

  return {
    build: {
      outDir: "dist/client",
    },
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    plugins: [
      ...(dev ? [wbBridge()] : []),
      react(dev ? { babel: { plugins: [[wbJsxSource, { attr: "data-wb-src" }]] } } : {}),
    ],
  };
});
