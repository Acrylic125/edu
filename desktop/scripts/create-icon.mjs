import { copyFile } from "node:fs/promises"

await copyFile(
  new URL("../src/renderer/assets/app-icon.png", import.meta.url),
  new URL("../resources/icon.png", import.meta.url),
)
