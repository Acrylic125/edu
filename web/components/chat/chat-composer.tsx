"use client"

import {
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react"
import {
  AlertCircleIcon,
  ArrowUpIcon,
  BookOpenIcon,
  CalculatorIcon,
  CodeIcon,
  PaperclipIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"

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
  createComposerPreviewRegistry,
  ingestComposerImageFiles,
  MAX_COMPOSER_IMAGE_ATTACHMENTS,
  type ComposerImageAttachment,
  isPdfFile,
} from "@/lib/chat/composer-images"
import { sendGate } from "@/lib/chat/gate"
import {
  completeAssetUpload,
  putBlobWithProgress,
  requestAssetUploadUrl,
} from "@/lib/chat/upload-asset"
import type {
  ChatMessageAttachment,
  Gate,
  RunFact,
  SocketFact,
} from "@/lib/chat/types"
import { cn } from "@/lib/utils"

type ChatComposerProps = {
  onSend: (content: string, attachments: ChatMessageAttachment[]) => Promise<void>
  onStop: () => void
  socket: SocketFact
  run: RunFact
  className?: string
  newTopicMode?: boolean
}

const LEARNING_SUGGESTIONS = [
  { label: "Learn calculus", description: "Limits, derivatives and integrals", prompt: "Help me learn calculus, starting with limits, derivatives and integrals.", icon: CalculatorIcon },
  { label: "Explore automata", description: "From finite states to languages", prompt: "Help me learn automata and formal languages, starting with finite automata.", icon: CodeIcon },
  { label: "Prepare for an exam", description: "Turn your papers into practice", prompt: "Help me prepare for my exam using my slides and past year papers.", icon: BookOpenIcon },
]

export function ChatComposer({
  onSend,
  onStop,
  socket,
  run,
  className,
  newTopicMode = false,
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const previewsRef = useRef(createComposerPreviewRegistry())
  const submitAbortRef = useRef<AbortController | null>(null)

  const gate = sendGate(
    socket,
    run,
    draft,
    images.length > 0,
    composerImagesReady(images) && !isSubmitting
  )
  const canSend =
    gate === "send" &&
    (!newTopicMode || (draft.trim() !== "" && !/^\/new\s*$/i.test(draft)))

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
      for (const image of result.added) {
        previewsRef.current.track(image)
      }
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
        previewsRef.current.release(removed)
      }
      return current.filter((image) => image.id !== imageId)
    })
  }

  async function uploadAttachment(
    image: ComposerImageAttachment,
    token: string,
    signal: AbortSignal
  ) {
    if (image.assetId && image.status === "ready" && image.mimeType) {
      return { id: image.assetId, name: image.name, mimeType: image.mimeType, previewUrl: image.previewUrl }
    }
    patchImage(image.id, { status: "uploading", progress: 0, error: null })
    let blob: Blob = image.file
    let filename = image.name
    let mimeType: "image/jpeg" | "application/pdf" = "application/pdf"
    if (!isPdfFile(image.file)) {
      blob = await compressImageForUpload(image.file)
      filename = jpegFilename(image.name)
      mimeType = "image/jpeg"
    }
    if (signal.aborted) {
      throw new DOMException("Upload cancelled", "AbortError")
    }

    const signed = await requestAssetUploadUrl({
      token,
      filename,
      mimeType,
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
      mimeType,
      sizeBytes: blob.size,
      status: "ready",
      progress: 1,
      error: null,
    })

    return {
      id: signed.assetId,
      name: image.name,
      mimeType,
      previewUrl: image.previewUrl,
    } satisfies ChatMessageAttachment
  }

  async function submit(content = draft, imageSnapshot = images) {
    const submitGate = sendGate(
      socket,
      run,
      content,
      imageSnapshot.length > 0,
      composerImagesReady(imageSnapshot) && !isSubmitting,
    )
    if (submitGate !== "send" || isSubmitting) {
      return
    }

    const text = content.trim()
    if (
      (text === "" && imageSnapshot.length === 0) ||
      (newTopicMode && (text === "" || /^\/new\s*$/i.test(text)))
    ) {
      return
    }

    const token = session.data?.session.token
    if (imageSnapshot.length > 0 && !token) {
      setAttachmentError("Sign in to upload files.")
      return
    }

    setIsSubmitting(true)
    setAttachmentError(null)
    const controller = new AbortController()
    submitAbortRef.current = controller
    const snapshot = imageSnapshot

    try {
      const attachments: ChatMessageAttachment[] = []
      if (token) {
        for (const image of snapshot) {
          attachments.push(await uploadAttachment(image, token, controller.signal))
        }
      }

      await onSend(text, attachments)
      setDraft("")
      // Message bubble keeps showing these object URLs — hand off ownership, don't revoke.
      previewsRef.current.transferAll()
      setImages([])
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return
      }
      const message =
        error instanceof Error ? error.message : "Could not upload file"
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
    const supportedFiles = files.filter(
      (file) => file.type.startsWith("image/") || isPdfFile(file)
    )
    if (supportedFiles.length === 0) {
      return
    }
    event.preventDefault()
    addImageFiles(supportedFiles)
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
      {newTopicMode ? (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Learning suggestions">
          {LEARNING_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              disabled={isSubmitting || run.status === "running"}
              className="flex min-h-20 flex-col items-start justify-center gap-3 rounded-xl border border-border bg-card/40 px-5 py-4 text-left transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none sm:min-h-32"
              onClick={() => {
                setDraft(suggestion.prompt)
                textareaRef.current?.focus()
              }}
            >
              <suggestion.icon className="hidden size-5 text-primary sm:block" aria-hidden="true" />
              <span>
                <span className="block text-sm font-medium">{suggestion.label}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{suggestion.description}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <form
        onSubmit={handleSubmit}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative flex min-h-28 w-full flex-col rounded-2xl border border-border/80 bg-input/25 shadow-lg backdrop-blur-xl",
          newTopicMode && "min-h-44 border-input/60 bg-card shadow-sm focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/20",
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
              Drop images or PDFs to attach
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
          <div ref={mirrorRef} className="pointer-events-none absolute inset-0 max-h-40 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words px-4 pt-3 pb-2 text-sm leading-relaxed text-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-hidden>
            <ComposerHighlightText text={draft} />
          </div>
          {draft.length === 0 ? (
            <div
              className="pointer-events-none absolute inset-0 px-4 pt-3 pb-2 text-sm leading-relaxed text-muted-foreground"
              aria-hidden
            >
              {newTopicMode
                ? "What would you like to learn?"
                : "Ask or answer questions"}
            </div>
          ) : null}
          <Textarea
            ref={textareaRef}
            aria-label="Message"
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
              "min-h-16 max-h-40 w-full flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent px-4 pt-3 pb-2 text-sm leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent",
              newTopicMode && "min-h-28",
              "relative text-transparent caret-foreground selection:bg-primary/25"
            )}
          />
        </div>

        <div className="flex items-center justify-between gap-2 px-3 pb-3">
          <div className="flex min-w-0 items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/gif,image/jpeg,image/png,image/webp,application/pdf"
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
              className={newTopicMode ? "size-11 sm:size-8" : undefined}
              aria-label="Attach files"
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

          <ComposerActionButton gate={gate} canSend={canSend} onStop={onStop} />
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
  gate,
  canSend,
  onStop,
}: {
  gate: Gate
  canSend: boolean
  onStop: () => void
}) {
  if (gate === "stop") {
    return (
      <Button
        type="button"
        variant="destructive"
        size="icon-sm"
        className="rounded-full"
        aria-label="Stop"
        onClick={onStop}
      >
        <SquareIcon className="size-3 fill-white" />
      </Button>
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
