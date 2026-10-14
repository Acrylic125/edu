import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react"
import { MediaPreview } from "./media-preview"

function subscribeTheme(listener: () => void) {
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  })
  return () => observer.disconnect()
}

let renderQueue = Promise.resolve()

export function MermaidDiagram({ definition, magnifiable = true }: { definition: string; magnifiable?: boolean }) {
  const dark = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  )
  const reactId = useId()
  const container = useRef<HTMLDivElement>(null)
  const renderKey = `${dark}:${definition}`
  const [result, setResult] = useState({ key: "", failed: false })
  const failed = result.key === renderKey && result.failed
  const ready = result.key === renderKey && !failed

  useEffect(() => {
    const target = container.current
    if (!target) return
    let active = true
    target.replaceChildren()

    async function render() {
      if (!active || !target) return
      // Debounce streamed definitions and serialize Mermaid's global configuration.
      try {
        if (definition.length > 16000) throw new Error("Diagram is too large")
        const mermaid = (await import("mermaid")).default
        if (!active) return
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          maxTextSize: 16000,
          maxEdges: 200,
          theme: dark ? "dark" : "default",
        })
        const id = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`
        const { svg } = await mermaid.render(id, definition)
        if (!active) return
        target.innerHTML = svg
        setResult({ key: renderKey, failed: false })
      } catch {
        if (active) setResult({ key: renderKey, failed: true })
      }
    }

    const timer = window.setTimeout(() => {
      renderQueue = renderQueue.then(render, render)
    }, 200)
    return () => {
      active = false
      window.clearTimeout(timer)
      target.replaceChildren()
    }
  }, [dark, definition, reactId, renderKey])

  const diagram = (
    <div className="min-w-0 rounded-lg border border-border bg-card p-3">
      <div
        ref={container}
        role="img"
        aria-label="Mermaid diagram"
        className="overflow-x-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
        hidden={result.key !== renderKey || failed}
      />
      {result.key !== renderKey && (
        <p role="status" className="text-xs text-muted-foreground">Rendering diagram…</p>
      )}
      {failed && (
        <div>
          <p className="mb-2 text-xs text-muted-foreground">This diagram could not be rendered. Its source is shown below.</p>
          <pre><code>{definition}</code></pre>
        </div>
      )}
    </div>
  )

  if (!magnifiable) return diagram

  return (
    <MediaPreview
      label="Mermaid diagram"
      preview={<MermaidDiagram definition={definition} magnifiable={false} />}
    >
      {(open) => (
        <div
          role="button"
          tabIndex={ready ? 0 : -1}
          aria-label="Magnify Mermaid diagram"
          aria-haspopup="dialog"
          aria-disabled={!ready}
          className={`rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${ready ? "cursor-zoom-in" : ""}`}
          onClick={(event) => {
            if (ready) open(event)
          }}
          onKeyDown={(event) => {
            if (ready && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault()
              event.currentTarget.click()
            }
          }}
        >
          {diagram}
        </div>
      )}
    </MediaPreview>
  )
}
