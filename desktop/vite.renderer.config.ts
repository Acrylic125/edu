import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"

export default defineConfig({
  root: "src/renderer",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": resolve("../web") },
    dedupe: ["react", "react-dom"],
  },
  server: { port: 5174, strictPort: true },
})
