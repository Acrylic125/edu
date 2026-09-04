"use client"

import { useEffect, useId, useState, useSyncExternalStore } from "react"

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

export function MermaidDiagram({ definition }: { definition: string }) {
  const reactId = useId()
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
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
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
      <div className="flex min-h-28 items-center justify-center rounded-md border border-border bg-muted/30 text-xs text-muted-foreground">
        Rendering diagram…
      </div>
    )
  }

  return (
    <div
      className="mermaid-diagram flex max-w-full justify-center overflow-x-auto rounded-md border border-border bg-card p-3 [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  )
}
