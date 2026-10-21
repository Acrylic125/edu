// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { PlotlyVisualization } from "../src/renderer/visualization/plotly-visualization"

const runtime = vi.hoisted(() => ({
  react: vi.fn<(target: HTMLElement, data: object[], layout: object, config: object) => Promise<HTMLElement>>(),
  purge: vi.fn<(target: HTMLElement) => void>(),
  resize: vi.fn(),
  load: vi.fn(),
}))
vi.mock("../src/renderer/visualization/plotly-runtime", async (original) => {
  const actual = await original<typeof import("../src/renderer/visualization/plotly-runtime")>()
  return { ...actual, loadPlotly: runtime.load }
})
const host = document.createElement("div")
let root: ReturnType<typeof createRoot>
const settings = { type: "Plotly.js", data: [{ type: "scatter", x: [1], y: [2] }], layout: { title: { text: "Sample" } } }
const source = `<visualization settings='${JSON.stringify(settings)}' />`
const disconnect = vi.fn()
beforeEach(() => {
  document.body.append(host)
  root = createRoot(host)
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect = disconnect })
  runtime.react.mockImplementation(async (target) => { target.textContent = "Rendered plot"; return target })
  runtime.load.mockResolvedValue({ react: runtime.react, purge: runtime.purge, Plots: { resize: runtime.resize }, PlotSchema: { get: () => ({ traces: { scatter: {} } }) } })
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.replaceChildren()
  host.remove()
  document.documentElement.classList.remove("dark")
  vi.clearAllMocks()
})
async function render(props = { source }) {
  await act(async () => { root.render(createElement(PlotlyVisualization, props)) })
}
it("keeps partial and invalid settings local without loading Plotly", async () => {
  await act(async () => root.render(createElement(PlotlyVisualization, { source: "<visualization", pending: true })))
  expect(host.textContent).toContain("Preparing visualization")
  await render({ source: "<visualization settings='{}' />" })
  expect(host.querySelector("details")?.textContent).toContain("settings='{}'")
  expect(runtime.load).not.toHaveBeenCalled()
})
it("renders interactive settings with clamped sizing and cleans up the chart", async () => {
  await render()
  expect(host.textContent).toContain("Rendered plot")
  expect(host.querySelector('[aria-label="Sample"]')).not.toBeNull()
  expect(runtime.react.mock.calls[0][2]).toMatchObject({ autosize: true, height: 400 })
  expect(runtime.react.mock.calls[0][3]).toMatchObject({ responsive: true, staticPlot: false, showSendToCloud: false })
  await act(async () => root.unmount())
  expect(runtime.purge).toHaveBeenCalled()
  expect(disconnect).toHaveBeenCalled()
  root = createRoot(host)
})
it("does not mount after a delayed import is replaced", async () => {
  let finish = () => {}
  runtime.load.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ react: runtime.react, purge: runtime.purge, Plots: { resize: runtime.resize }, PlotSchema: { get: () => ({ traces: { scatter: {} } }) } }) }))
  await render()
  await render({ source: "<visualization settings='{}' />" })
  await act(async () => finish())
  expect(host.textContent).toContain("could not be rendered")
  expect(runtime.react).not.toHaveBeenCalled()
})
it("shows a recoverable error on rendering and import failures", async () => {
  runtime.react.mockRejectedValueOnce(new Error("WebGL unavailable"))
  await render()
  expect(host.textContent).toContain("WebGL unavailable")
  runtime.load.mockRejectedValueOnce(new Error("Loading failed"))
  await render({ source: source.replace("Sample", "Other") })
  expect(host.textContent).toContain("Loading failed")
})
it("keeps user view revision stable across theme updates and purges an in-flight render", async () => {
  await render()
  const revision = runtime.react.mock.calls[0][2]
  await act(async () => { document.documentElement.classList.add("dark"); await Promise.resolve() })
  expect(runtime.react.mock.calls.at(-1)?.[2]).toMatchObject({ uirevision: Reflect.get(revision, "uirevision") })
  let finish = () => {}
  runtime.react.mockImplementationOnce((target) => new Promise((resolve) => { finish = () => resolve(target) }))
  await render({ source: source.replace("Sample", "New") })
  await act(async () => root.unmount())
  await act(async () => finish())
  expect(host.querySelector(".js-plotly-plot")).toBeNull()
  expect(runtime.purge).toHaveBeenCalled()
  root = createRoot(host)
})

it("keeps an existing plot mounted while the tutor streams later prose", async () => {
  if (!document.doctype) document.insertBefore(document.implementation.createDocumentType("html", "", ""), document.documentElement)
  const { StudyMarkdown } = await import("../src/renderer/markdown")
  await act(async () => root.render(createElement(StudyMarkdown, { text: source + "\n\nFirst" })))
  expect(host.textContent).toContain("Rendered plot")
  const target = runtime.react.mock.calls.at(-1)?.[0]
  runtime.react.mockClear()
  runtime.purge.mockClear()
  await act(async () => root.render(createElement(StudyMarkdown, { text: source + "\n\nFirst and more" })))
  expect(host.contains(target!)).toBe(true)
  expect(runtime.react).not.toHaveBeenCalled()
  expect(runtime.purge).not.toHaveBeenCalled()
})
