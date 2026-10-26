import { resolve } from "node:path"
import { defineConfig } from "electron-vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  main: {
    build: {
      outDir: ".test-out/rendering/main",
      rollupOptions: { input: resolve("test/rendering-electron.ts") },
    },
  },
  renderer: {
    root: "test/rendering",
    plugins: [react()],
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: { "react-dom/client": "react-dom/profiling" },
    },
    build: {
      assetsInlineLimit: 0,
      outDir: resolve(".test-out/rendering/renderer"),
      rollupOptions: { input: resolve("test/rendering/index.html") },
    },
  },
})
