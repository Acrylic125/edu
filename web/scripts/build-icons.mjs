import { readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"

const requireNext = createRequire(import.meta.resolve("next/package.json"))
const sharp = requireNext("sharp")
const artwork = await readFile(new URL("../public/brand/edu-books-artwork.png", import.meta.url))
// Ignore nearly transparent generation residue when fitting the books to the canvas.
const source = await sharp(artwork)
  .ensureAlpha()
  .trim({ threshold: 16 })
  .resize(1024, 1024, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer()

await Promise.all([
  sharp(source).resize(512, 512).png().toFile(new URL("../app/icon.png", import.meta.url).pathname),
  sharp(source).resize(180, 180).png().toFile(new URL("../app/apple-icon.png", import.meta.url).pathname),
  sharp(source).png().toFile(new URL("../public/brand/edu-books-icon.png", import.meta.url).pathname),
  // Optical padding balances the stack beside the wordmark without changing the sidebar layout.
  sharp(source)
    .resize(840, 840)
    .extend({
      top: 92,
      bottom: 92,
      left: 92,
      right: 92,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(new URL("../../desktop/src/renderer/assets/app-icon.png", import.meta.url).pathname),
])

const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = await Promise.all(
  sizes.map((size) => sharp(source).resize(size, size).ensureAlpha().png().toBuffer()),
)

// Next.js decodes the embedded PNGs, which must include an alpha channel.
const header = Buffer.alloc(6 + sizes.length * 16)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
let offset = header.length

for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16
  const dimension = size % 256
  header.writeUInt8(dimension, entry)
  header.writeUInt8(dimension, entry + 1)
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(images[index].length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += images[index].length
}

await writeFile(new URL("../app/favicon.ico", import.meta.url), Buffer.concat([header, ...images]))
