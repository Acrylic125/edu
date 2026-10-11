import { createCanvas, GlobalFonts } from "@napi-rs/canvas"
import { writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const canvas = createCanvas(1024, 1024)
const context = canvas.getContext("2d")
GlobalFonts.loadSystemFonts()
context.fillStyle = "#fafafa"
context.beginPath()
context.roundRect(64, 64, 896, 896, 190)
context.fill()
context.fillStyle = "#eee9e6"
context.beginPath()
context.roundRect(190, 190, 644, 644, 130)
context.fill()
context.strokeStyle = "#c1aea3"
context.lineWidth = 16
context.stroke()
context.fillStyle = "#634a3e"
context.font = "540px Georgia, serif"
context.textAlign = "center"
context.textBaseline = "middle"
context.fillText("P", 512, 535)
await writeFile(
  fileURLToPath(new URL("../resources/icon.png", import.meta.url)),
  canvas.toBuffer("image/png"),
)
