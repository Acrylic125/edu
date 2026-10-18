import { z } from "zod"

const JsonSchema = z.json()

function containsExternalAsset(value: z.infer<typeof JsonSchema>): boolean {
  if (Array.isArray(value)) return value.some(containsExternalAsset)
  if (value === null || typeof value !== "object") return false
  for (const [key, child] of Object.entries(value)) {
    if (/src$|^source$|^images$|^mapbox$|^map$|^geo$/i.test(key)) return true
    if (key === "symbol" && typeof child === "string" && /url\(/i.test(child)) return true
    if (containsExternalAsset(child)) return true
  }
  return false
}

export const VisualizationSettingsSchema = z.object({
  type: z.literal("Plotly.js"),
  data: z.array(z.object({ type: z.string().min(1) }).catchall(JsonSchema))
    .min(1).max(50)
    .refine((traces) => traces.every((trace) => !/geo$|^choropleth$|^(?:scattermap|choroplethmap|densitymap)/i.test(trace.type)), "Geographic plots requiring external assets are unavailable"),
  layout: z.record(z.string(), JsonSchema).default({}),
  config: z.strictObject({
    displayModeBar: z.union([z.boolean(), z.literal("hover")]).optional(),
    scrollZoom: z.boolean().optional(),
    displaylogo: z.boolean().optional(),
    locale: z.enum(["en", "en-US"]).optional(),
  }).default({}),
}).strict().refine((settings) => !containsExternalAsset(settings), "Use local coordinate data; external assets are unavailable")

export function parseVisualizationSettings(source: string) {
  if (source.length > 500_000) return { success: false as const, error: "Visualization exceeds 500,000 characters." }
  try {
    const result = VisualizationSettingsSchema.safeParse(JSON.parse(source))
    if (!result.success) return { success: false as const, error: "Invalid visualization settings: " + z.prettifyError(result.error) }
    return { success: true as const, settings: result.data }
  } catch {
    return { success: false as const, error: "Visualization settings must be valid JSON." }
  }
}

export const visualizationInstructions = `Interactive visualizations:
Use Plotly.js visualizations when they clarify graphs, plots, functions, matrices, transformations, trends, or 2D/3D spatial relationships. Include them in chat and in saved conceptual topic summaries when useful.
Write a standalone element surrounded by blank lines: <visualization settings='STRICT_JSON' />. settings is strict JSON, not JSX or executable code. Encode apostrophes inside JSON strings as \\u0027. Required fields: type: "Plotly.js", data: a nonempty array of Plotly traces with explicit trace types. Optional: layout and config. Supply literal sampled coordinates for functions and computed coordinates for matrix transformations. Never provide expressions to execute.
2D example:
<visualization settings='{"type":"Plotly.js","data":[{"type":"scatter","mode":"lines","x":[-2,-1,0,1,2],"y":[4,1,0,1,4]}],"layout":{"title":{"text":"y = x²"},"xaxis":{"title":{"text":"x"}},"yaxis":{"title":{"text":"y"}}}}' />
3D example:
<visualization settings='{"type":"Plotly.js","data":[{"type":"surface","x":[-1,0,1],"y":[-1,0,1],"z":[[2,1,2],[1,0,1],[2,1,2]]}],"layout":{"title":{"text":"z = x² + y²"},"scene":{"xaxis":{"title":{"text":"x"}},"yaxis":{"title":{"text":"y"}},"zaxis":{"title":{"text":"z"}}}}}' />
Use heatmap traces for matrices, scatter/scatter3d lines for vectors and transformations, and surface/mesh3d for spatial shapes. Give meaningful titles, axis labels, units where relevant, and sensible ranges. Explain briefly what the learner should observe. Distinguish illustrative data from supplied/source data. Preserve existing source-image and citation guidance: embed supplied source images for source-specific figures; a reconstruction must be identified as illustrative. Keep answer keys private under the existing tutoring rules.
Use at most 50 traces and 500,000 characters per element. layout supports ordinary Plotly styling, shapes and annotations. Use local data only: no external images, maps, source references, callbacks, or animation frames. Optional config keys: displayModeBar (boolean or "hover"), scrollZoom, displaylogo, locale ("en" or "en-US"). The app controls responsive sizing; default height is 400px, with requested heights clamped to 240–800px. Interactive hover, zoom, pan and 3D rotation are provided by the app.`
