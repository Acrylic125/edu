export const MAX_COMPOSER_IMAGE_ATTACHMENTS = 4

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const

export type ComposerImageAttachment = {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  previewUrl: string
  file: File
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
    name: file.name || "image",
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: URL.createObjectURL(file),
    file,
  }
}

export function ingestComposerImageFiles(
  files: File[],
  current: ReadonlyArray<ComposerImageAttachment>
): { nextImages: ComposerImageAttachment[]; error: string | null } {
  const nextImages = [...current]
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
    nextImages.push(createComposerImageAttachment(file))
  }

  return { nextImages, error }
}

export function revokeComposerImageAttachment(
  attachment: ComposerImageAttachment
): void {
  URL.revokeObjectURL(attachment.previewUrl)
}
