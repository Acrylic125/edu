import { resolve } from "node:path"
import { defineConfig } from "electron-vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  main: {
    build: {
      // Bundle the ESM Markdown plugins so CommonJS receives their plugin functions.
      externalizeDeps: { exclude: ["unified", "remark-parse", "remark-gfm"] },
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          worker: resolve("src/runners/worker.ts"),
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: { input: { index: resolve("src/main/preload.ts") } },
    },
  },
  renderer: {
    root: "src/renderer",
    plugins: [react(), tailwindcss()],
    resolve: {
      dedupe: ["react", "react-dom"],
    },
  },
})
