"use client"

import { Loader2Icon, XIcon } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { ChatMessageAttachment } from "@/lib/chat/types"
import type { ComposerImageAttachment } from "@/lib/chat/composer-images"
import { cn } from "@/lib/utils"

export type ImagePreview = {
  name: string
  previewUrl: string
}

type ComposerImageStripProps = {
  images: ComposerImageAttachment[]
  onRemove: (imageId: string) => void
  onExpand?: (image: ComposerImageAttachment) => void
  className?: string
}

export function ComposerImageStrip({
  images,
  onRemove,
  onExpand,
  className,
}: ComposerImageStripProps) {
  if (images.length === 0) {
    return null
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {images.map((image) => {
        const showOverlay = image.status === "uploading"
        return (
          <div
            key={image.id}
            className="relative h-16 w-16 overflow-hidden rounded-lg border border-border/80 bg-background"
          >
            <button
              type="button"
              className="h-full w-full cursor-zoom-in"
              aria-label={`Preview ${image.name}`}
              onClick={() => {
                onExpand?.(image)
              }}
            >
              <img
                src={image.previewUrl}
                alt={image.name}
                className="h-full w-full object-cover"
              />
            </button>
            {showOverlay ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50">
                <Loader2Icon
                  className="size-5 animate-spin text-white"
                  aria-hidden
                />
              </div>
            ) : null}
            {image.status === "error" ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 px-1 text-center text-[10px] leading-tight text-white">
                {image.error ?? "Failed"}
              </div>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute right-1 top-1 z-10 bg-background/80 hover:bg-background/90"
              onClick={() => {
                onRemove(image.id)
              }}
              aria-label={`Remove ${image.name}`}
            >
              <XIcon />
            </Button>
          </div>
        )
      })}
    </div>
  )
}

type MessageImageGridProps = {
  images: ChatMessageAttachment[]
  onExpand?: (image: ChatMessageAttachment) => void
  className?: string
}

export function MessageImageGrid({
  images,
  onExpand,
  className,
}: MessageImageGridProps) {
  if (images.length === 0) {
    return null
  }

  return (
    <div className={cn("mb-2 grid max-w-[420px] grid-cols-2 gap-2", className)}>
      {images.map((image) => (
        <div
          key={image.id}
          className="overflow-hidden rounded-lg border border-border/80 bg-background/70"
        >
          <button
            type="button"
            className="h-full w-full cursor-zoom-in"
            aria-label={`Preview ${image.name}`}
            onClick={() => {
              onExpand?.(image)
            }}
          >
            <img
              src={image.previewUrl}
              alt={image.name}
              className="block h-auto max-h-[220px] w-full object-cover"
            />
          </button>
        </div>
      ))}
    </div>
  )
}

export function ImagePreviewDialog(props: {
  image: ImagePreview | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[min(96vw,56rem)] gap-0 overflow-hidden p-2 sm:p-3">
        {props.image ? (
          <>
            <DialogTitle className="sr-only">{props.image.name}</DialogTitle>
            <img
              src={props.image.previewUrl}
              alt={props.image.name}
              className="max-h-[min(80vh,48rem)] w-full rounded-md object-contain"
            />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
