import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const port = Number(process.env.PORT ?? "23695");
const basePath = process.env.BASE_PATH ?? "/";

const plugins = [react(), tailwindcss(), runtimeErrorOverlay()];

if (process.env.REPL_ID) {
  const { cartographer } = await import("@replit/vite-plugin-cartographer");
  plugins.push(cartographer());
}

export default defineConfig({
  base: basePath,
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: true,
    allowedHosts: true,
    strictPort: true,
  },
  preview: {
    port,
    host: true,
    allowedHosts: true,
  },
});
