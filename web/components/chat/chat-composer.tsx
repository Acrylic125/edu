"use client"

import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react"
import { AlertCircleIcon, ArrowUpIcon, PaperclipIcon, SquareIcon, XIcon } from "lucide-react"

import { useSession } from "@/lib/auth-client"
import {
  ComposerImageStrip,
  ImagePreviewDialog,
} from "@/components/chat/composer-attachments"
import { ComposerHighlightText } from "@/components/chat/composer-highlight-text"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { compressImageForUpload, jpegFilename } from "@/lib/chat/compress-image"
import {
  composerImagesReady,
  ingestComposerImageFiles,
  MAX_COMPOSER_IMAGE_ATTACHMENTS,
  revokeComposerImageAttachment,
  type ComposerImageAttachment,
} from "@/lib/chat/composer-images"
import { sendAffordance as composerSendAffordance } from "@/lib/chat/state"
import {
  completeAssetUpload,
  putBlobWithProgress,
  requestAssetUploadUrl,
} from "@/lib/chat/upload-asset"
import type {
  ChatActivity,
  ChatConnection,
  ChatMessageAttachment,
  SendAffordance,
} from "@/lib/chat/types"
import { cn } from "@/lib/utils"

type ChatComposerProps = {
  onSend: (content: string, attachments: ChatMessageAttachment[]) => void
  onStop: () => void
  connection: ChatConnection
  activity: ChatActivity
  className?: string
}

const COMPOSER_INPUT_CLASS =
  "min-h-16 max-h-40 w-full flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent px-4 pt-3 pb-2 text-sm leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"

const COMPOSER_MIRROR_CLASS =
  "pointer-events-none absolute inset-0 max-h-40 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words px-4 pt-3 pb-2 text-sm leading-relaxed text-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"

export function ChatComposer({
  onSend,
  onStop,
  connection,
  activity,
  className,
}: ChatComposerProps) {
  const session = useSession()
  const [draft, setDraft] = useState("")
  const [images, setImages] = useState<ComposerImageAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [expandedImage, setExpandedImage] = useState<ComposerImageAttachment | null>(
    null
  )
  const [isDragOver, setIsDragOver] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const imagesRef = useRef(images)
  imagesRef.current = images
  const submitAbortRef = useRef<AbortController | null>(null)

  const sendAffordance = composerSendAffordance(
    connection,
    activity,
    draft,
    images.length > 0,
    composerImagesReady(images) && !isSubmitting
  )
  const canSend = sendAffordance === "send"

  useEffect(() => {
    return () => {
      for (const image of imagesRef.current) {
        revokeComposerImageAttachment(image)
      }
      submitAbortRef.current?.abort()
    }
  }, [])

  function patchImage(
    imageId: string,
    patch: Partial<ComposerImageAttachment>
  ) {
    setImages((current) =>
      current.map((image) => {
        if (image.id !== imageId) {
          return image
        }
        return { ...image, ...patch }
      })
    )
  }

  function addImageFiles(files: File[]) {
    if (files.length === 0 || isSubmitting) {
      return
    }

    let error: string | null = null
    setImages((current) => {
      const result = ingestComposerImageFiles(files, current)
      error = result.error
      return result.nextImages
    })
    setAttachmentError(error)
  }

  function removeImage(imageId: string) {
    if (isSubmitting) {
      return
    }
    setImages((current) => {
      const removed = current.find((image) => image.id === imageId)
      if (removed) {
        revokeComposerImageAttachment(removed)
      }
      return current.filter((image) => image.id !== imageId)
    })
  }

  async function uploadImage(
    image: ComposerImageAttachment,
    token: string,
    signal: AbortSignal
  ) {
    patchImage(image.id, { status: "uploading", progress: 0, error: null })
    const blob = await compressImageForUpload(image.file)
    if (signal.aborted) {
      throw new DOMException("Upload cancelled", "AbortError")
    }

    const signed = await requestAssetUploadUrl({
      token,
      filename: jpegFilename(image.name),
      mimeType: "image/jpeg",
      size: blob.size,
    })
    if (signal.aborted) {
      throw new DOMException("Upload cancelled", "AbortError")
    }

    await putBlobWithProgress({
      url: signed.uploadUrl,
      blob,
      headers: {
        ...signed.headers,
        Authorization: `Bearer ${token}`,
      },
      signal,
      onProgress: (progress) => {
        patchImage(image.id, { status: "uploading", progress })
      },
    })
    await completeAssetUpload({ token, assetId: signed.assetId })
    if (signal.aborted) {
      throw new DOMException("Upload cancelled", "AbortError")
    }

    patchImage(image.id, {
      assetId: signed.assetId,
      mimeType: "image/jpeg",
      sizeBytes: blob.size,
      status: "ready",
      progress: 1,
      error: null,
    })

    return {
      id: signed.assetId,
      name: image.name,
      mimeType: "image/jpeg",
      previewUrl: image.previewUrl,
    } satisfies ChatMessageAttachment
  }

  async function submit() {
    if (sendAffordance !== "send" || isSubmitting) {
      return
    }

    const text = draft.trim()
    const snapshot = imagesRef.current
    if (text === "" && snapshot.length === 0) {
      return
    }

    const token = session.data?.session.token
    if (snapshot.length > 0 && !token) {
      setAttachmentError("Sign in to upload images.")
      return
    }

    setIsSubmitting(true)
    setAttachmentError(null)
    const controller = new AbortController()
    submitAbortRef.current = controller

    try {
      const attachments: ChatMessageAttachment[] = []
      if (token) {
        for (const image of snapshot) {
          attachments.push(await uploadImage(image, token, controller.signal))
        }
      }

      onSend(text, attachments)
      setDraft("")
      // Keep preview URLs alive for the message bubble (t3code clearComposerContent).
      setImages([])
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return
      }
      const message =
        error instanceof Error ? error.message : "Could not upload image"
      setAttachmentError(message)
      setImages((current) =>
        current.map((image) => {
          if (image.status !== "uploading") {
            return image
          }
          return { ...image, status: "error", error: message }
        })
      )
    } finally {
      if (submitAbortRef.current === controller) {
        submitAbortRef.current = null
      }
      setIsSubmitting(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submit()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files)
    const imageFiles = files.filter((file) => file.type.startsWith("image/"))
    if (imageFiles.length === 0) {
      return
    }
    event.preventDefault()
    addImageFiles(imageFiles)
  }

  function handleDragOver(event: DragEvent<HTMLFormElement>) {
    if (![...event.dataTransfer.types].includes("Files")) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    setIsDragOver(true)
  }

  function handleDragLeave(event: DragEvent<HTMLFormElement>) {
    if (![...event.dataTransfer.types].includes("Files")) {
      return
    }
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return
    }
    setIsDragOver(false)
  }

  function handleDrop(event: DragEvent<HTMLFormElement>) {
    if (![...event.dataTransfer.types].includes("Files")) {
      return
    }
    event.preventDefault()
    setIsDragOver(false)
    addImageFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <>
      <form
        onSubmit={handleSubmit}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative flex min-h-28 w-full flex-col rounded-2xl border border-border/80 bg-input/25 shadow-lg backdrop-blur-xl",
          isDragOver && "border-primary/60 ring-2 ring-primary/20",
          className
        )}
      >
        {isDragOver ? (
          <div
            className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/50 bg-primary/5"
            aria-hidden
          >
            <div className="flex items-center gap-2 rounded-full border border-primary/25 bg-background/95 px-4 py-2 text-sm font-medium shadow-lg">
              <PaperclipIcon className="size-4 text-primary" aria-hidden />
              Drop images to attach
            </div>
          </div>
        ) : null}

        {attachmentError ? (
          <Alert variant="destructive" className="mx-3 mt-3 border-destructive/30 py-2">
            <AlertCircleIcon />
            <AlertDescription className="flex items-start justify-between gap-2">
              <span>{attachmentError}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-destructive hover:text-destructive"
                aria-label="Dismiss error"
                onClick={() => {
                  setAttachmentError(null)
                }}
              >
                <XIcon />
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {images.length > 0 ? (
          <ComposerImageStrip
            images={images}
            onRemove={removeImage}
            onExpand={setExpandedImage}
            className="px-4 pt-3"
          />
        ) : null}

        <div className="relative min-h-16 flex-1">
          <div ref={mirrorRef} className={COMPOSER_MIRROR_CLASS} aria-hidden>
            <ComposerHighlightText text={draft} />
          </div>
          {draft.length === 0 ? (
            <div
              className="pointer-events-none absolute inset-0 px-4 pt-3 pb-2 text-sm leading-relaxed text-muted-foreground"
              aria-hidden
            >
              Ask or answer questions, or type /new
            </div>
          ) : null}
          <Textarea
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
            }}
            onScroll={(event) => {
              if (mirrorRef.current) {
                mirrorRef.current.scrollTop = event.currentTarget.scrollTop
              }
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder=""
            rows={1}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className={cn(
              COMPOSER_INPUT_CLASS,
              "relative text-transparent caret-foreground selection:bg-primary/25"
            )}
          />
        </div>

        <div className="flex items-center justify-between gap-2 px-3 pb-3">
          <div className="flex items-center">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/gif,image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                addImageFiles(Array.from(event.target.files ?? []))
                event.target.value = ""
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Attach images"
              disabled={
                isSubmitting || images.length >= MAX_COMPOSER_IMAGE_ATTACHMENTS
              }
              onClick={() => {
                fileInputRef.current?.click()
              }}
            >
              <PaperclipIcon />
            </Button>
          </div>

          <ComposerActionButton
            sendAffordance={sendAffordance}
            canSend={canSend}
            onStop={onStop}
          />
        </div>
      </form>

      <ImagePreviewDialog
        open={expandedImage !== null}
        onOpenChange={(open) => {
          if (!open) {
            setExpandedImage(null)
          }
        }}
        image={
          expandedImage
            ? { name: expandedImage.name, previewUrl: expandedImage.previewUrl }
            : null
        }
      />
    </>
  )
}

function ComposerActionButton({
  sendAffordance,
  canSend,
  onStop,
}: {
  sendAffordance: SendAffordance
  canSend: boolean
  onStop: () => void
}) {
  if (sendAffordance === "stop") {
    return (
      <button
        type="button"
        aria-label="Stop"
        onClick={onStop}
        className={cn(buttonVariants({ size: "icon-sm" }), "rounded-full")}
      >
        <SquareIcon />
      </button>
    )
  }

  return (
    <button
      type="submit"
      aria-label="Send"
      {...(!canSend ? { "aria-disabled": true as const, tabIndex: -1 } : {})}
      className={cn(
        buttonVariants({ size: "icon-sm" }),
        "rounded-full",
        !canSend && "pointer-events-none opacity-50"
      )}
    >
      <ArrowUpIcon />
    </button>
  )
}
