import { describe, expect, it } from "vitest"
import { parseVisualizationSettings } from "../src/shared/visualization"

const trace = { type: "scatter", x: [0, 1], y: [0, 1] }
const valid = { type: "Plotly.js", data: [trace] }

describe("visualization settings", () => {
  it("accepts literal 2D, 3D and matrix data with defaults", () => {
    for (const data of [[trace], [{ type: "surface", z: [[1, 2], [3, 4]] }], [{ type: "heatmap", z: [[0, 1]] }]]) {
      expect(parseVisualizationSettings(JSON.stringify({ ...valid, data }))).toMatchObject({ success: true, settings: { layout: {}, config: {} } })
    }
  })
  it.each([
    {}, { ...valid, type: "Other" }, { ...valid, data: [] }, { ...valid, data: [1] },
    { ...valid, data: [{}] }, { ...valid, data: Array.from({ length: 51 }, () => trace) },
    { ...valid, config: { plotlyServerURL: "https://example.com" } },
    { ...valid, layout: { images: [{ source: "https://example.com/image.png" }] } },
    { ...valid, data: [{ type: "image", source: "https://example.com/image.png" }] },
    { ...valid, data: [{ ...trace, xsrc: "owner:dataset" }] },
    { ...valid, data: [{ ...trace, marker: { symbol: "url(https://example.com/image.png)" } }] },
    { ...valid, data: [{ type: "scattergeo", lat: [1], lon: [2] }] },
    { ...valid, data: [{ type: "choropleth", locations: ["USA"], z: [1] }] },
  ])("rejects invalid or remote settings: %j", (settings) => {
    expect(parseVisualizationSettings(JSON.stringify(settings)).success).toBe(false)
  })
  it("bounds size before parsing and rejects invalid or infinite JSON", () => {
    for (const source of [" ".repeat(500_001), "{", '{"type":"Plotly.js","data":[{"type":"scatter","x":[1e999]}]}']) {
      expect(parseVisualizationSettings(source).success).toBe(false)
    }
    expect(parseVisualizationSettings(JSON.stringify({ ...valid, data: Array.from({ length: 50 }, () => trace) })).success).toBe(true)
  })
  it("retains annotations and escaped label strings", () => {
    const source = String.raw`{"type":"Plotly.js","data":[{"type":"scatter","x":[1],"y":[2],"text":["student\u0027s <value> />"]}],"layout":{"annotations":[{"text":"\\(x\\)"}]},"config":{"scrollZoom":true,"displayModeBar":"hover"}}`
    expect(parseVisualizationSettings(source)).toMatchObject({ success: true, settings: { data: [{ text: ["student's <value> />"] }], layout: { annotations: [{ text: String.raw`\(x\)` }] } } })
  })
})
