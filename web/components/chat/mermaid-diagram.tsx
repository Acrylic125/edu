"use client"

import { useEffect, useId, useState, useSyncExternalStore } from "react"

import { ImagePreviewDialog } from "@/components/chat/composer-attachments"

function subscribeToDarkMode(onStoreChange: () => void) {
  const observer = new MutationObserver(onStoreChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  })
  return () => {
    observer.disconnect()
  }
}

function getDarkModeSnapshot() {
  return document.documentElement.classList.contains("dark")
}

function getServerDarkModeSnapshot() {
  return false
}

function getSvgAspectRatio(svg: string) {
  const viewBox = svg.match(
    /\bviewBox=["']\s*[^\s"']+\s+[^\s"']+\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*["']/i
  )
  if (viewBox) {
    return Number(viewBox[1]) / Number(viewBox[2])
  }

  const width = svg.match(/\bwidth=["'](\d+(?:\.\d+)?)/i)
  const height = svg.match(/\bheight=["'](\d+(?:\.\d+)?)/i)
  if (width && height) {
    return Number(width[1]) / Number(height[1])
  }

  return undefined
}

export function MermaidDiagram({ definition }: { definition: string }) {
  const reactId = useId()
  const [previewOpen, setPreviewOpen] = useState(false)
  const dark = useSyncExternalStore(
    subscribeToDarkMode,
    getDarkModeSnapshot,
    getServerDarkModeSnapshot
  )
  const renderKey = `${dark}:${definition}`
  const [result, setResult] = useState({
    key: "",
    svg: null as string | null,
    error: false,
  })

  useEffect(() => {
    let active = true

    async function renderDiagram() {
      try {
        const mermaid = (await import("mermaid")).default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "default",
        })
        const id = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`
        const rendered = await mermaid.render(id, definition)
        if (active) {
          setResult({ key: renderKey, svg: rendered.svg, error: false })
        }
      } catch {
        if (active) {
          setResult({ key: renderKey, svg: null, error: true })
        }
      }
    }

    void renderDiagram()
    return () => {
      active = false
    }
  }, [dark, definition, reactId, renderKey])

  if (result.key === renderKey && result.error) {
    return (
      <div className="w-full rounded-md border border-destructive/30 bg-destructive/5 p-3">
        <p className="mb-2 text-xs text-destructive">
          This Mermaid diagram could not be rendered.
        </p>
        <pre className="overflow-x-auto text-xs">
          <code>{definition}</code>
        </pre>
      </div>
    )
  }

  if (result.key !== renderKey || result.svg === null) {
    return (
      <div className="flex min-h-28 w-full items-center justify-center rounded-md border border-border bg-muted/30 text-xs text-muted-foreground">
        Rendering diagram…
      </div>
    )
  }

  const previewUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`
  const aspectRatio = getSvgAspectRatio(result.svg)

  return (
    <>
      <button
        type="button"
        className="block w-full cursor-zoom-in text-left"
        aria-label="Preview Mermaid diagram"
        onClick={() => {
          setPreviewOpen(true)
        }}
      >
        <span
          className="mermaid-diagram flex w-full justify-center overflow-x-auto rounded-md border border-border bg-card p-3 [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-none!"
          dangerouslySetInnerHTML={{ __html: result.svg }}
        />
      </button>
      <ImagePreviewDialog
        image={{ name: "Mermaid diagram", previewUrl }}
        open={previewOpen}
        panZoom
        aspectRatio={aspectRatio}
        onOpenChange={setPreviewOpen}
      />
    </>
  )
}
