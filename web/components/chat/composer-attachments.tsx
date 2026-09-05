"use client"

import { Loader2Icon, XIcon } from "lucide-react"
import { useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react"

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
  panZoom?: boolean
  aspectRatio?: number
}) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
  })

  function clampOffset(nextOffset: { x: number; y: number }, nextScale = scale) {
    const viewport = viewportRef.current
    const image = imageRef.current
    if (viewport == null || image == null) {
      return nextOffset
    }

    const maxX = Math.max(0, (image.offsetWidth * nextScale - viewport.clientWidth) / 2)
    const maxY = Math.max(0, (image.offsetHeight * nextScale - viewport.clientHeight) / 2)
    return {
      x: Math.min(maxX, Math.max(-maxX, nextOffset.x)),
      y: Math.min(maxY, Math.max(-maxY, nextOffset.y)),
    }
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!props.panZoom) {
      return
    }
    event.preventDefault()
    setScale((current) => {
      const nextScale = Math.min(
        4,
        Math.max(1, current * (event.deltaY < 0 ? 1.1 : 0.9))
      )
      setOffset((currentOffset) => clampOffset(currentOffset, nextScale))
      return nextScale
    })
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!props.panZoom || scale === 1) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag.active || drag.pointerId !== event.pointerId) {
      return
    }
    setOffset(
      clampOffset({
        x: drag.offsetX + event.clientX - drag.startX,
        y: drag.offsetY + event.clientY - drag.startY,
      })
    )
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current.pointerId === event.pointerId) {
      dragRef.current.active = false
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="w-screen max-w-none gap-0 overflow-hidden p-2 sm:max-w-none sm:p-3">
        {props.image ? (
          <>
            <DialogTitle className="sr-only">{props.image.name}</DialogTitle>
            <div
              ref={viewportRef}
              className={cn(
                "relative flex w-full items-center justify-center overflow-hidden rounded-md bg-black/10",
                props.aspectRatio
                  ? "h-auto max-h-[min(86vh,52rem)]"
                  : "h-[min(86vh,52rem)]",
                props.panZoom && scale > 1 ? "cursor-grab active:cursor-grabbing" : ""
              )}
              style={props.aspectRatio ? { aspectRatio: props.aspectRatio } : undefined}
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <img
                ref={imageRef}
                src={props.image.previewUrl}
                alt={props.image.name}
                draggable={false}
                className="max-h-full max-w-full select-none rounded-md object-contain"
                style={{
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                }}
              />
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
