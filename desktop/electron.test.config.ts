import { resolve } from "node:path"
import { defineConfig } from "electron-vite"

export default defineConfig({
  main: {
    build: {
      outDir: ".test-out",
      externalizeDeps: { exclude: ["unified", "remark-parse", "remark-gfm"] },
      rollupOptions: { input: { workflow: resolve("test/workflow-electron.ts"), worker: resolve("src/runners/worker.ts") } },
    },
  },
  preload: {
    build: {
      outDir: ".test-out/preload",
      externalizeDeps: false,
      rollupOptions: { input: { index: resolve("src/main/preload.ts") } },
    },
  },
})
