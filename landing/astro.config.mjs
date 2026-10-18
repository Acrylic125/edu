import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://edu.benapps.dev",
  vite: {
    plugins: [tailwindcss()],
  },
  devToolbar: { enabled: false },
});
