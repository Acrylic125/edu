import { useCallback, useState, type MouseEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Minus, Plus, X } from "lucide-react"

export function MediaPreview({ label, children, preview }: {
  label: string
  children: (open: (event: MouseEvent<HTMLElement>) => void) => ReactNode
  preview: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const showDialog = useCallback((dialog: HTMLDialogElement | null) => {
    if (!dialog || dialog.open) return
    dialog.showModal()
    dialog.querySelector<HTMLButtonElement>('[aria-label="Close preview"]')?.focus()
  }, [])

  return (
    <>
      {children((event) => {
        // Linked images should open the preview without navigating away.
        event.preventDefault()
        event.stopPropagation()
        setZoom(1)
        setOpen(true)
      })}
      {open && createPortal(
        <dialog
          ref={showDialog}
          aria-label={label}
          className="m-auto h-[calc(100dvh-48px)] max-h-none w-[calc(100vw-48px)] max-w-none overflow-hidden rounded-xl border border-border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/70"
          onClose={() => setOpen(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) event.currentTarget.close()
          }}
        >
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
              <button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - 0.5))} className="rounded-md p-2 hover:bg-accent disabled:opacity-40"><Minus className="size-4" /></button>
              <button type="button" aria-label="Reset zoom" onClick={() => setZoom(1)} className="rounded-md px-2 py-1 text-xs tabular-nums hover:bg-accent">{Math.round(zoom * 100)}%</button>
              <button type="button" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom((value) => Math.min(3, value + 0.5))} className="rounded-md p-2 hover:bg-accent disabled:opacity-40"><Plus className="size-4" /></button>
              <button type="button" autoFocus aria-label="Close preview" onClick={(event) => event.currentTarget.closest("dialog")?.close()} className="ml-2 rounded-md p-2 hover:bg-accent"><X className="size-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
              <div style={{ width: `${zoom * 100}%`, maxHeight: `calc((100dvh - 160px) * ${zoom})` }} className="grid min-h-full items-center p-6 [&_img]:h-auto [&_img]:max-h-[inherit] [&_img]:w-full [&_img]:object-contain [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-none!">
                {preview}
              </div>
            </div>
          </div>
        </dialog>,
        document.body,
      )}
    </>
  )
}
