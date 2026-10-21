import type { Data, Layout } from "plotly.js"
import { parseVisualizationSettings } from "../../shared/visualization"

export function loadPlotly() {
  return import("plotly.js-strict-dist-min")
}

export function preparePlotlyFigure(
  settings: Extract<ReturnType<typeof parseVisualizationSettings>, { success: true }>["settings"],
  traces: Record<string, object>,
  dark: boolean,
  revision: string,
) {
  for (const trace of settings.data) {
    if (!Object.hasOwn(traces, trace.type)) throw new Error(`Unsupported Plotly trace: ${trace.type}`)
  }
  const foreground = dark ? "#e8e6e1" : "#292d29"
  const background = dark ? "#20241f" : "#ffffff"
  const grid = dark ? "#41483f" : "#e2e7df"
  const axis = { gridcolor: grid, zerolinecolor: grid, linecolor: grid }
  // JSON structure and trace names are validated; Plotly supplies attribute defaults/coercions.
  const data = structuredClone(settings.data) as Data[]
  const layout: Partial<Layout> = {
    template: { layout: {
      paper_bgcolor: background, plot_bgcolor: background,
      font: { color: foreground }, colorway: ["#518a71", "#be7850", "#6889be", "#b477a1"],
      xaxis: axis, yaxis: axis, scene: { xaxis: axis, yaxis: axis, zaxis: axis },
    } },
    margin: { l: 55, r: 30, t: 65, b: 55 },
    ...structuredClone(settings.layout) as Partial<Layout>,
    width: undefined,
    height: 400,
    autosize: true,
    uirevision: revision,
  }
  if (typeof settings.layout.height === "number") layout.height = Math.min(800, Math.max(240, settings.layout.height))
  return {
    data, layout,
    config: {
      ...settings.config, responsive: true, staticPlot: false,
      displaylogo: settings.config.displaylogo ?? false,
      showSendToCloud: false,
      modeBarButtonsToRemove: ["sendDataToCloud" as const],
    },
  }
}
