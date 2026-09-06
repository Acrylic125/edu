"use client"

import {
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import { PaperclipIcon, PlusIcon } from "lucide-react"

import { ComposerImageStrip } from "@/components/chat/composer-attachments"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import {
  ingestComposerImageFiles,
  MAX_COMPOSER_IMAGE_ATTACHMENTS,
  revokeComposerImageAttachment,
  type ComposerImageAttachment,
} from "@/lib/chat/composer-images"

export function NewTopicDialog({
  onCreate,
  prominent = false,
  disabled = false,
  initialTopic = "",
  triggerContent,
  triggerClassName,
}: {
  onCreate: (topic: string, files: File[]) => void
  prominent?: boolean
  disabled?: boolean
  initialTopic?: string
  triggerContent?: ReactNode
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState(initialTopic)
  const [images, setImages] = useState<ComposerImageAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function reset() {
    for (const image of images) {
      revokeComposerImageAttachment(image)
    }
    setTopic(initialTopic)
    setImages([])
    setAttachmentError(null)
    setIsDragOver(false)
  }

  function addImageFiles(files: File[]) {
    let error: string | null = null
    setImages((current) => {
      const result = ingestComposerImageFiles(files, current)
      error = result.error
      return result.nextImages
    })
    setAttachmentError(error)
  }

  function removeImage(imageId: string) {
    setImages((current) => {
      const removed = current.find((image) => image.id === imageId)
      if (removed) {
        revokeComposerImageAttachment(removed)
      }
      return current.filter((image) => image.id !== imageId)
    })
  }

  function createTopic() {
    if (disabled) {
      return
    }
    const trimmedTopic = topic.trim()
    if (trimmedTopic === "") {
      return
    }

    onCreate(
      trimmedTopic,
      images.map((image) => image.file)
    )
    reset()
    setOpen(false)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    event.stopPropagation()
    createTopic()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      createTopic()
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
    event.stopPropagation()
    event.dataTransfer.dropEffect = "copy"
    setIsDragOver(true)
  }

  function handleDragLeave(event: DragEvent<HTMLFormElement>) {
    if (![...event.dataTransfer.types].includes("Files")) {
      return
    }
    event.stopPropagation()
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
    event.stopPropagation()
    setIsDragOver(false)
    addImageFiles(Array.from(event.dataTransfer.files))
  }

  let trigger = (
    <Button
      type="button"
      variant={prominent ? "default" : "ghost"}
      size="sm"
      className={prominent ? undefined : "px-2"}
      disabled={disabled}
    />
  )
  if (triggerContent) {
    trigger = (
      <button
        type="button"
        className={triggerClassName}
        disabled={disabled}
      />
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          reset()
        }
      }}
    >
      <DialogTrigger render={trigger}>
        {triggerContent ?? (
          <>
            <PlusIcon />
            {prominent ? "Create Topic" : "New Topic"}
          </>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-3 overflow-y-auto bg-transparent p-0 ring-0 sm:max-w-lg">
        <DialogHeader className="px-4 py-2 pr-12">
          <DialogTitle>What do you want to learn about?</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="relative"
        >
          <div className="flex max-h-[min(60dvh,28rem)] min-h-32 flex-col overflow-hidden rounded-2xl border border-border/80 bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10">
            {isDragOver ? (
              <div
                className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/50 bg-primary/5"
                aria-hidden
              >
                <div className="flex items-center gap-2 rounded-full border border-primary/25 bg-background/95 px-4 py-2 text-sm font-medium shadow-lg">
                  <PaperclipIcon className="size-4 text-primary" />
                  Drop images to attach
                </div>
              </div>
            ) : null}
            {images.length > 0 ? (
              <ComposerImageStrip
                images={images}
                onRemove={removeImage}
                className="shrink-0 px-4 pt-3"
              />
            ) : null}
            <Textarea
              autoFocus
              value={topic}
              onChange={(event) => {
                setTopic(event.target.value)
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Describe a topic you want to learn about"
              rows={3}
              className="min-h-24 flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent px-4 pt-3 pb-2 text-sm leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <div className="flex shrink-0 items-center justify-between px-3 pb-3">
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
                disabled={images.length >= MAX_COMPOSER_IMAGE_ATTACHMENTS}
                onClick={() => {
                  fileInputRef.current?.click()
                }}
              >
                <PaperclipIcon />
              </Button>
              <Button
                type="submit"
                disabled={disabled || topic.trim() === ""}
              >
                Create
              </Button>
            </div>
            {attachmentError ? (
              <p className="px-4 pb-3 text-xs text-destructive">
                {attachmentError}
              </p>
            ) : null}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
