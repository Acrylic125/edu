import { resolve } from "node:path"
import { defineConfig } from "electron-vite"

export default defineConfig({
  main: {
    build: {
      outDir: ".test-out",
      externalizeDeps: { exclude: ["unified", "remark-parse", "remark-gfm"] },
      rollupOptions: { input: { workflow: resolve("test/workflow-electron.ts"), worker: resolve("src/runners/worker.ts"), "source-images": resolve("test/source-images-electron.ts"), "source-images-worker": resolve("test/source-images-worker.ts") } },
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
