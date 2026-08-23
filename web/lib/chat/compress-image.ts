export const MAX_UPLOAD_BYTES = 256 * 1024
export const MAX_IMAGE_EDGE = 1024
const JPEG_QUALITY = 0.82
const MIN_EDGE = 32

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not compress image"))
          return
        }
        resolve(blob)
      },
      mimeType,
      quality
    )
  })
}

export async function compressImageForUpload(file: File) {
  const bitmap = await createImageBitmap(file)
  let width = bitmap.width
  let height = bitmap.height
  const longest = Math.max(width, height)

  if (longest > MAX_IMAGE_EDGE) {
    const scale = MAX_IMAGE_EDGE / longest
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))
  }

  try {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext("2d")
      if (!context) {
        throw new Error("Could not compress image")
      }
      context.drawImage(bitmap, 0, 0, width, height)
      const blob = await canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY)
      if (blob.size <= MAX_UPLOAD_BYTES) {
        return blob
      }
      if (width <= MIN_EDGE && height <= MIN_EDGE) {
        throw new Error("Image is still larger than 256 KB after shrinking")
      }
      width = Math.max(1, Math.round(width * 0.75))
      height = Math.max(1, Math.round(height * 0.75))
    }
    throw new Error("Image is still larger than 256 KB after shrinking")
  } finally {
    bitmap.close()
  }
}

export function jpegFilename(name: string) {
  const trimmed = name.trim()
  const dot = trimmed.lastIndexOf(".")
  if (dot <= 0) {
    return "image.jpg"
  }
  return `${trimmed.slice(0, dot)}.jpg`
}
