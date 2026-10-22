import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { dedupe: ["react", "react-dom"] },
  esbuild: { jsx: "automatic" },
  test: {
    server: { deps: { inline: [/@base-ui/, /packages\/ui/] } },
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
})
