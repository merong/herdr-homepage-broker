import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Interactive dashboard components only. The plain-JS shell in src/web/public
// owns layout, SSE and dialogs, and mounts these through window.BrokerUI.
export default defineConfig({
  publicDir: false,
  logLevel: "warn",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  esbuild: { jsx: "automatic", legalComments: "none" },
  build: {
    outDir: fileURLToPath(new URL("./dist/src/web/public/ui", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      // lucide-react marks its modules "use client"; meaningless in an IIFE.
      onwarn(warning, warn) {
        if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
      },
    },
    // A classic deferred script: minified, and it runs before app.js in
    // document order (lib-mode ES output keeps whitespace unminified).
    lib: {
      entry: fileURLToPath(new URL("./src/web/ui/main.tsx", import.meta.url)),
      name: "BrokerUIBundle",
      formats: ["iife"],
      fileName: () => "components.js",
    },
  },
});
