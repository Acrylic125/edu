declare module "plotly.js-strict-dist-min" {
  export * from "plotly.js"
  export const PlotSchema: { get(): { traces: Record<string, object> } }
}
