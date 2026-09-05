"use client"

import { useEffect, useId, useState } from "react"

import { useThemeMode } from "@/components/theme/theme-provider"

import { ImagePreviewDialog } from "@/components/chat/composer-attachments"

const mermaidSvgCache = new Map<string, string>()
let renderQueue = Promise.resolve()

function isMermaidErrorSvg(svg: string) {
  return /syntax error in text|mermaid version/i.test(svg)
}

function getCachedSvg(key: string) {
  const cached = mermaidSvgCache.get(key)
  if (cached !== undefined && isMermaidErrorSvg(cached)) {
    mermaidSvgCache.delete(key)
    return null
  }
  return cached ?? null
}

function getSvgAspectRatio(svg: string) {
  const viewBox = svg.match(
    /\bviewBox=["']\s*[^\s"']+\s+[^\s"']+\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*["']/i,
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

export function MermaidDiagram({
  definition,
  renderScope,
}: {
  definition: string
  renderScope: string
}) {
  const reactId = useId()
  const [previewOpen, setPreviewOpen] = useState(false)
  const { dark } = useThemeMode()
  const renderKey = `${dark}:${renderScope}:${definition}`
  const [result, setResult] = useState(() => {
    const cachedSvg = getCachedSvg(renderKey)
    return {
      key: cachedSvg == null ? "" : renderKey,
      svg: cachedSvg,
      error: false,
    }
  })
  const cachedSvg = getCachedSvg(renderKey)
  const svg = result.key === renderKey ? result.svg : cachedSvg
  const renderError = result.key === renderKey && result.error

  useEffect(() => {
    if (cachedSvg != null) {
      return
    }

    let active = true

    async function renderDiagram() {
      try {
        if (!active) return
        if (definition.length > 16000) throw new Error("Diagram is too large")
        const mermaid = (await import("mermaid")).default
        mermaid.initialize({
          startOnLoad: false,
          maxTextSize: 16000,
          maxEdges: 200,
          suppressErrorRendering: true,
          securityLevel: "strict",
          theme: dark ? "dark" : "default",
        })
        const id = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`
        const rendered = await mermaid.render(id, definition)
        if (isMermaidErrorSvg(rendered.svg)) {
          throw new Error("Mermaid returned an error diagram")
        }
        if (active) {
          if (mermaidSvgCache.size >= 32) {
            const oldest = mermaidSvgCache.keys().next().value
            if (oldest !== undefined) mermaidSvgCache.delete(oldest)
          }
          mermaidSvgCache.set(renderKey, rendered.svg)
          setResult({ key: renderKey, svg: rendered.svg, error: false })
        }
      } catch {
        if (active) {
          setResult({ key: renderKey, svg: null, error: true })
        }
      }
    }

    // Mermaid configuration and temporary DOM are global; serialize rendering.
    renderQueue = renderQueue.then(renderDiagram, renderDiagram)
    return () => {
      active = false
    }
  }, [cachedSvg, dark, definition, reactId, renderKey])

  if (renderError) {
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

  if (svg === null) {
    return (
      <div className="flex h-[min(70vh,32rem)] w-full items-center justify-center rounded-md border border-border bg-muted/30 text-xs text-muted-foreground">
        Rendering diagram…
      </div>
    )
  }

  const previewUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  const aspectRatio = getSvgAspectRatio(svg)

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
          className="mermaid-diagram block h-[min(70vh,32rem)] w-full overflow-auto rounded-md border border-border bg-card p-3 [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-none!"
          dangerouslySetInnerHTML={{ __html: svg }}
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
