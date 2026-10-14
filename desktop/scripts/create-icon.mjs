import { writeFile } from "node:fs/promises"
import { createCanvas, loadImage } from "@napi-rs/canvas"

const artwork = await loadImage(
  new URL("../src/renderer/assets/app-icon.png", import.meta.url),
)
const size = 1024
// macOS pre-Tahoe dock icons keep an 824px body inset 100px, instead of a full-bleed square.
const inset = 100
const body = size - inset * 2
const canvas = createCanvas(size, size)
const context = canvas.getContext("2d")

function squircle(ctx, x, y, extent) {
  const n = 5
  const centerX = x + extent / 2
  const centerY = y + extent / 2
  const radius = extent / 2 - 1
  ctx.beginPath()
  const steps = 720
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * Math.PI * 2
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    const pointX = centerX + Math.sign(cosine) * radius * Math.abs(cosine) ** (2 / n)
    const pointY = centerY + Math.sign(sine) * radius * Math.abs(sine) ** (2 / n)
    if (step === 0) {
      ctx.moveTo(pointX, pointY)
    } else {
      ctx.lineTo(pointX, pointY)
    }
  }
  ctx.closePath()
}

context.save()
context.shadowColor = "rgba(0, 0, 0, 0.28)"
context.shadowBlur = 18
context.shadowOffsetY = 8
squircle(context, inset, inset, body)
context.fillStyle = "#FFFFFF"
context.fill()
context.restore()

context.save()
squircle(context, inset, inset, body)
context.clip()
context.drawImage(artwork, inset, inset, body, body)
context.restore()

await writeFile(
  new URL("../resources/icon.png", import.meta.url),
  canvas.toBuffer("image/png"),
)
