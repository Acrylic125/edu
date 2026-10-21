import { useEffect, useMemo, useRef, useState } from "react"
import { MediaPreview } from "../media-preview"
import { parseVisualizationSettings } from "../../shared/visualization"
import { loadPlotly, preparePlotlyFigure } from "./plotly-runtime"

export function PlotlyVisualization({ source, pending = false, magnifiable = true }: {
  source: string
  pending?: boolean
  magnifiable?: boolean
}) {
  const parsed = useMemo(() => {
    if (pending) return { success: false as const, error: "" }
    if (source.length > 500_000) return { success: false as const, error: "Visualization exceeds 500,000 characters." }
    const match = /^<visualization\s+settings='([\s\S]*)'\s*\/>$/.exec(source)
    if (!match) return { success: false as const, error: "Use a single-quoted JSON settings attribute." }
    return parseVisualizationSettings(match[1])
  }, [source, pending])
  const container = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState({ source: "", error: "", ready: false })
  let title = "Interactive visualization"
  if (parsed.success) {
    const candidate = parsed.settings.layout.title
    if (typeof candidate === "string" && candidate.trim()) title = candidate
    else if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && typeof candidate.text === "string" && candidate.text.trim()) title = candidate.text
  }

  useEffect(() => {
    const host = container.current
    if (!host || !parsed.success) return
    const target = document.createElement("div")
    host.append(target)
    let active = true
    let plotly: Awaited<ReturnType<typeof loadPlotly>> | undefined
    let queue = Promise.resolve()
    const fail = (error: Error) => {
      if (active) setResult({ source, error: error.message, ready: false })
    }
    const render = () => {
      queue = queue.then(async () => {
        if (!active) return
        plotly = await loadPlotly()
        if (!active) return
        const figure = preparePlotlyFigure(parsed.settings, plotly.PlotSchema.get().traces, document.documentElement.classList.contains("dark"), source)
        await plotly.react(target, figure.data, figure.layout, figure.config)
        if (active) setResult({ source, error: "", ready: true })
      }).catch((error) => fail(error instanceof Error ? error : new Error("Plotly could not render this visualization.")))
    }
    const resize = new ResizeObserver(() => {
      queue = queue.then(async () => {
        if (active && plotly) await plotly.Plots.resize(target)
      }).catch(() => {})
    })
    resize.observe(host)
    const theme = new MutationObserver(render)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    const lostContext = () => fail(new Error("The 3D graphics context is unavailable. Try reopening the visualization."))
    target.addEventListener("webglcontextlost", lostContext, true)
    render()
    return () => {
      active = false
      resize.disconnect()
      theme.disconnect()
      target.removeEventListener("webglcontextlost", lostContext, true)
      target.remove()
      // Purge after the last render settles so an in-flight WebGL render cannot recreate resources.
      void queue.finally(() => plotly?.purge(target))
    }
  }, [parsed, source])

  let error = ""
  if (!parsed.success && !pending) error = parsed.error
  else if (result.source === source) error = result.error
  const ready = result.source === source && result.ready && !error
  const chart = (
    <figure className="m-0 min-w-0 overflow-hidden rounded-lg border border-border bg-card p-3" aria-label={title}>
      <div ref={container} className="min-w-0 w-full" hidden={pending || !!error} />
      {pending && <p role="status" className="text-sm text-muted-foreground">Preparing visualization…</p>}
      {!pending && !error && !ready && <p role="status" className="text-sm text-muted-foreground">Rendering visualization…</p>}
      {error && <div role="alert" className="text-sm text-muted-foreground">
        <p>This visualization could not be rendered. {error}</p>
        <details className="mt-2"><summary className="cursor-pointer">View visualization source</summary><pre className="max-h-80 overflow-auto"><code>{source}</code></pre></details>
      </div>}
      {magnifiable && ready && <MediaPreview label={title} preview={<PlotlyVisualization source={source} magnifiable={false} />}>
        {(open) => <button type="button" onClick={open} className="mt-2 rounded-md border border-border px-3 py-1 text-xs hover:bg-accent" aria-label="Expand visualization">Expand visualization</button>}
      </MediaPreview>}
    </figure>
  )
  return chart
}
