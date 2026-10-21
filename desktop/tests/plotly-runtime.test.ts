import { expect, it } from "vitest"
import { parseVisualizationSettings } from "../src/shared/visualization"
import { preparePlotlyFigure } from "../src/renderer/visualization/plotly-runtime"

it("keeps teaching colors and input data intact while enforcing local responsive sizing", () => {
  const parsed = parseVisualizationSettings('{"type":"Plotly.js","data":[{"type":"scatter","x":[0,1],"y":[1,2],"line":{"color":"red"}}],"layout":{"height":999,"width":1200,"font":{"color":"blue"}}}')
  if (!parsed.success) throw new Error(parsed.error)
  const figure = preparePlotlyFigure(parsed.settings, { scatter: {} }, true, "stable-view")
  expect(figure.layout).toMatchObject({ height: 800, width: undefined, autosize: true, font: { color: "blue" }, uirevision: "stable-view" })
  expect(figure.data[0]).toMatchObject({ line: { color: "red" } })
  Reflect.set(figure.data[0], "x", [7])
  expect(parsed.settings.data[0].x).toEqual([0, 1])
  expect(parsed.settings.layout.width).toBe(1200)
  parsed.settings.layout.height = 1
  expect(preparePlotlyFigure(parsed.settings, { scatter: {} }, false, "view").layout.height).toBe(240)
  expect(() => preparePlotlyFigure(parsed.settings, {}, false, "view")).toThrow("Unsupported Plotly trace")
})
