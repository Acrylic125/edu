export const MAX_COMPOSER_IMAGE_ATTACHMENTS = 5

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const

export type ComposerImageStatus = "ready" | "uploading" | "error"

export type ComposerImageAttachment = {
  id: string
  assetId: string | null
  name: string
  mimeType: string
  sizeBytes: number
  previewUrl: string
  file: File
  status: ComposerImageStatus
  progress: number
  error: string | null
}

export function isSupportedImageFile(file: File): boolean {
  return (
    file.type.startsWith("image/") &&
    SUPPORTED_IMAGE_MIME_TYPES.includes(
      file.type as (typeof SUPPORTED_IMAGE_MIME_TYPES)[number]
    )
  )
}

export function createComposerImageAttachment(file: File): ComposerImageAttachment {
  return {
    id: crypto.randomUUID(),
    assetId: null,
    name: file.name || "image",
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: URL.createObjectURL(file),
    file,
    // Local preview only. Bytes go to the API on send (t3code pattern).
    status: "ready",
    progress: 1,
    error: null,
  }
}

export function ingestComposerImageFiles(
  files: File[],
  current: ReadonlyArray<ComposerImageAttachment>
): {
  nextImages: ComposerImageAttachment[]
  added: ComposerImageAttachment[]
  error: string | null
} {
  const nextImages = [...current]
  const added: ComposerImageAttachment[] = []
  let error: string | null = null

  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      error = `"${file.name}" is not an image. Attach GIF, JPEG, PNG, or WebP files only.`
      continue
    }
    if (!isSupportedImageFile(file)) {
      error = `"${file.name}" is not a supported image type. Use GIF, JPEG, PNG, or WebP.`
      continue
    }
    if (nextImages.length >= MAX_COMPOSER_IMAGE_ATTACHMENTS) {
      error = `You can attach up to ${MAX_COMPOSER_IMAGE_ATTACHMENTS} images per message.`
      break
    }
    const attachment = createComposerImageAttachment(file)
    nextImages.push(attachment)
    added.push(attachment)
  }

  return { nextImages, added, error }
}

export function revokeComposerImageAttachment(
  attachment: ComposerImageAttachment
): void {
  URL.revokeObjectURL(attachment.previewUrl)
}

/** Tracks blob URLs the composer still owns (vs handed off to a sent message). */
export function createComposerPreviewRegistry() {
  const urls = new Set<string>()

  return {
    track(attachment: ComposerImageAttachment) {
      urls.add(attachment.previewUrl)
    },
    release(attachment: ComposerImageAttachment) {
      if (urls.delete(attachment.previewUrl)) {
        revokeComposerImageAttachment(attachment)
      }
    },
    /** Message bubble keeps showing these previews — stop owning without revoking. */
    transferAll() {
      urls.clear()
    },
  }
}

export function composerImagesReady(
  images: ReadonlyArray<ComposerImageAttachment>
) {
  if (images.length === 0) {
    return true
  }
  return images.every((image) => image.status === "ready")
}
