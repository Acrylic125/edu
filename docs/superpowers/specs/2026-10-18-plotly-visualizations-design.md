# Plotly visualizations in tutoring responses

## Purpose and agreed scope

Extend the EdU tutor so it can explain graphs, functions, matrices, transformations, trends, and spatial relationships with interactive 2D and 3D Plotly.js figures alongside prose and existing images. The user approved a custom `<visualization settings='…' />` element with strict JSON settings, available in chat and saved topic notes.

Success means the agent knows when and how to emit the element, the desktop renders it interactively, saved content renders again after reopening, and incomplete or invalid output does not break the surrounding explanation.

## Output contract

The canonical form is a standalone block surrounded by blank lines:

```html
<visualization settings='{
  "type": "Plotly.js",
  "data": [{
    "type": "scatter",
    "mode": "lines",
    "x": [-2, -1, 0, 1, 2],
    "y": [4, 1, 0, 1, 4]
  }],
  "layout": {
    "title": { "text": "y = x²" },
    "xaxis": { "title": { "text": "x" } },
    "yaxis": { "title": { "text": "y" } }
  },
  "config": { "displayModeBar": true }
}' />
```

- `type` is exactly `Plotly.js`.
- `data` is a nonempty array of Plotly trace objects with an explicit trace `type`.
- `layout` and `config` are optional objects, defaulting to empty objects.
- The attribute contains JSON, not a JavaScript expression. Functions, comments, JSX expressions, `NaN`, and `Infinity` are invalid. Encode apostrophes in JSON strings as `\u0027`.
- Coordinates are literal data arrays. For a function or transformation, the tutor supplies sampled values or computed coordinates and explains the function or matrix in accompanying prose.
- Supported examples include line/scatter/bar plots, heatmaps for matrices, contour plots, 3D scatter/lines, surfaces, and meshes. Use the installed Plotly library's supported trace types rather than a separate invented chart vocabulary.
- No new tool invocation, database field, or message-envelope variant is required. The element remains part of existing persisted Markdown text.

A fenced `plotly` block was considered but the element was selected to match the requested API and existing topic-directory convention. Do not add a second output syntax in this change.

## Parsing and validation

Add a visualization domain module under `desktop/src/shared` for the settings schema and canonical format guidance. Validate parsed JSON with Zod before passing it to the renderer; never cast raw JSON to Plotly types.

Validate the envelope and JSON-only object structure with Zod. Preserve Plotly trace and layout properties rather than duplicating Plotly's full schema. Reject trace types absent from the bundled Plotly schema. Use the library's exported TypeScript types at the rendering boundary, adapting validated JSON without an unchecked cast. Let Plotly handle optional attribute defaults and coercions; handle rendering rejections through the local error fallback rather than treating every validation warning as fatal.

Limit each element to 500,000 characters and at most 50 traces. Check the text size before JSON parsing. These limits bound accidental output size; they are not an attempt to validate all mathematical content.

Recognize only standalone visualization elements outside inline and fenced code, including multi-line JSON. Preserve example elements inside code literally. A dedicated Markdown transformation should recognize this element without enabling general raw HTML or evaluating JSX. Existing `skipHtml` behavior remains for unrelated HTML. Keep the JSON payload opaque to math-delimiter normalization and source-citation rewriting so strings inside plots are preserved exactly.

For a started but incomplete element, reserve a compact “Preparing visualization…” placeholder without exposing partial JSON as prose or mounting Plotly. Only parse and render after the closing element arrives. A completed but invalid element shows a local error and an expandable source view. Unknown visualization providers receive the same readable fallback.

## Renderer and lifecycle

Add a dedicated Plotly visualization component in the renderer and connect it to `StudyMarkdown`. This automatically covers chat responses and the topic-note views that already use that component.

Bundle Plotly locally and load it lazily when a completed, validated visualization needs rendering. Use a distribution containing both 2D and 3D traces; the basic bundle alone is insufficient. No CDN or network fetch is necessary to render a figure.

Synchronize the imperative Plotly instance with React through an effect, consistent with the repository's rule permitting effects for external libraries. Use `Plotly.react` for updates, observe container resizing with `ResizeObserver`, and call `Plotly.purge` during cleanup. Guard asynchronous loading/rendering so stale results cannot overwrite newer content or render into an unmounted container. Preserve pan/zoom and camera state across container resize and theme changes where Plotly supports it.

Figures fill the available width with a default height of 400 pixels. Respect a finite requested height within 240–800 pixels; ignore fixed figure width in favor of the container. Match light/dark app defaults for backgrounds, text, grid lines, and trace colors while retaining explicit instructional colors.

Enable interactive hover, pan/zoom, legend toggles, and 3D rotation as appropriate for each trace. Keep these interactions on the plot itself; do not use an enclosing click-to-magnify handler that intercepts dragging. Add a separate accessible “Expand visualization” button using the existing `MediaPreview` dialog, with an independently managed Plotly instance in the dialog.

Expose an accessible figure label from the title, falling back to “Interactive visualization”. Show loading and rendering status text. Catch renderer errors, including unavailable WebGL for 3D figures, and keep the explanation and recoverable source visible.

Only data-driven settings are accepted. Expose local presentation options such as mode-bar visibility, scroll zoom, and locale through a small validated config allowlist. Force responsive rendering and disable Chart Studio/cloud upload controls. Do not permit configuration of remote services, arbitrary callbacks, or external data loading. Keep image assets in the existing image path; reject external image sources in Plotly layout or marker settings for this iteration.

## Tutor guidance

Extend the desktop harness instructions in `desktop/src/runners/tutor.ts` with the canonical element format and concise usage guidance. This applies to every provider that uses the tutor session, without relying on a provider-specific tool.

Tell the tutor to use plots when they materially clarify an explanation, especially functions, trends, matrices, transformations, and 2D/3D relationships. Include a compact 2D example and a 3D example or reference. Require meaningful titles, axis labels and units where relevant, sensible ranges, and short prose explaining what to observe. Distinguish illustrative data from learner-supplied or source data. Use supplied source images for source-specific figures, retaining the existing citation behavior.

Permit the same element in conceptual topic summaries so useful visual explanations persist. Keep answer keys and private assessment state subject to existing tutoring boundaries.

## Files and integration boundaries

- `desktop/src/shared/visualization.ts`: JSON envelope validation, supported local configuration, and reusable output-format guidance.
- `desktop/src/renderer/visualization/`: Markdown integration and Plotly rendering, grouped within the visualization domain.
- `desktop/src/renderer/markdown.tsx`: register visualization rendering while preserving existing math, Mermaid, code, citations, anchors, and images.
- Existing math/citation preprocessing: make visualization payloads opaque where necessary; avoid unrelated refactoring.
- `desktop/src/runners/tutor.ts`: include visualization capability instructions.
- `desktop/package.json` and the relevant pnpm lockfile: add Plotly and library type dependencies.
- `desktop/tests/`: parser/schema, Markdown integration, tutor instruction, and browser coverage following existing test patterns.

No migrations are needed: chats and topic summaries already store text containing the element.

## Verification and acceptance criteria

1. A standalone 2D element renders an interactive line plot between ordinary Markdown paragraphs.
2. A 3D surface or scatter plot renders and can be rotated. A heatmap renders matrix values.
3. Multiple plots and plots in saved topic notes render independently and survive reopening.
4. Inline/fenced examples remain literal; ordinary HTML is still skipped; existing math, Mermaid, source images, citations, and topic links retain their behavior.
5. Apostrophes, angle brackets, math-like text, and citation-like text inside JSON strings survive unchanged.
6. Partial streamed elements show a placeholder and mount no chart. Completed malformed JSON, unsupported providers/types, oversized settings, forbidden external assets/config, and rendering failures show a local readable fallback.
7. Plot resizing, theme changes, expansion, content replacement, and unmounting do not leave stale charts, observers, or WebGL instances behind.
8. Tutor-session tests confirm the provider receives the format and guidance. Rendering requires no new agent tool.
9. Run focused unit tests, desktop typechecking, the relevant regression suite, a production renderer build, and a browser smoke check for representative 2D and 3D plots.

## Scope boundaries and trade-offs

Plotly increases the renderer bundle size; lazy loading keeps it out of the initial chat path. 3D plotting depends on the device's WebGL support. Literal JSON arrays make output portable and reviewable but require the agent to sample functions rather than execute expressions in the renderer. Mathematical correctness remains the tutor's responsibility; schema validation verifies structure and supported rendering, not the truth of the explanation.

This iteration does not add animation frames, arbitrary JavaScript, editable plotting code, external datasets, or a separate visualization authoring interface. Plotly's existing JSON layout features, including annotations and shapes, remain usable within the validated local-data contract.
