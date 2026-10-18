# Plotly Visualizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the tutor emit interactive Plotly.js figures in chat replies and saved topic explanations using `<visualization settings='…' />`.

**Architecture:** Extract visualization blocks before existing Markdown preprocessing, replacing them with internal Markdown nodes and keeping their JSON opaque. Validate settings with Zod and render through a lazy Plotly component integrated with `StudyMarkdown`. Include the canonical contract in the shared tutor instructions; retain text-based persistence.

**Tech Stack:** TypeScript, Zod 4, React 19, react-markdown, Plotly.js strict distribution, Vitest, Playwright/Electron, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-18-plotly-visualizations-design.md`

## Global Constraints

- `type` is exactly `Plotly.js`; `data` is a nonempty array of traces with explicit trace `type`; `layout` and `config` are optional objects.
- The attribute contains strict JSON inside single quotes; encode apostrophes as `\u0027`. No JSX evaluation, JavaScript expressions, callbacks, animation frames, or remote data loading.
- Limit each element to 500,000 characters and at most 50 traces; check size before JSON parsing.
- Default height is 400 pixels. Respect finite requested heights within 240–800 pixels; use container width.
- Keep existing `skipHtml`, code examples, math, Mermaid, citations, images, topic links, and anchors working.
- Reuse library types, validate JSON with Zod, prefer inference, and avoid `any`/`unknown` and unnecessary abstractions.
- Effects are for imperative Plotly/observer lifecycle only; derive validation and view state from inputs.
- No message/database migration. Preserve unrelated changes; do not commit unless requested.

## Review Focus

- A `/>` or escaped apostrophe inside a JSON string must not truncate an element (Task 1).
- Indented code, longer fences, CRLF, and incomplete fence streams must retain literal examples (Task 1).
- Replacement or unmount during lazy import or asynchronous rendering must not revive a stale figure or leak a WebGL instance (Task 2).
- A long title or a graph inside a narrow chat/sidebar must remain usable without document overflow (Task 4).
- Electron's existing CSP must permit both 2D and 3D plots without adding `unsafe-eval` or remote script permissions (Tasks 2 and 4).

## File Map

- Create `desktop/src/shared/visualization.ts`: settings schema, parsing, limits, canonical examples, and tutor guidance.
- Create `desktop/src/renderer/visualization/markdown.ts`: block extraction, opaque payload storage, and the narrowly scoped remark integration.
- Create `desktop/src/renderer/visualization/plotly-runtime.ts`: lazy Plotly import and adaptation of validated settings to library types.
- Create `desktop/src/renderer/visualization/plotly-visualization.tsx`: chart lifecycle, status/error UI, theme, resize, and expansion.
- Create `desktop/src/renderer/visualization/plotly.d.ts` only if the strict distribution has no bundled declarations; re-export the official `@types/plotly.js` module rather than inventing an API.
- Modify `desktop/src/renderer/markdown.tsx`: extract before preprocessing and render only internally registered visualization nodes.
- Modify `desktop/src/runners/tutor.ts`: include the shared guidance in all tutor sessions.
- Modify `desktop/package.json` and `desktop/pnpm-lock.yaml`: Plotly distribution and upstream types.
- Create `desktop/tests/visualization.test.ts`, `desktop/tests/visualization-markdown.test.ts`, `desktop/tests/visualization-lifecycle.test.ts`, and `desktop/tests/visualizations.smoke.ts`; extend existing Markdown and tutor tests.

### Task 1: Validated contract and opaque Markdown transport

**Interfaces:**
- `VisualizationSettingsSchema`: Zod envelope with JSON trace/layout objects and a strict local config allowlist.
- `parseVisualizationSettings(source: string)`: returns a discriminated `{ success: true, settings }` or `{ success: false, error }` result; all settings types are inferred from Zod.
- `visualizationInstructions`: concise guidance plus canonical 2D and 3D examples.
- `prepareVisualizationMarkdown(text: string)`: returns transformed text and ordered blocks with original source and `pending`/`complete` status. Generated internal nodes reference only blocks registered by this call.
- `visualizationMarkdown(blocks: ReturnType<typeof prepareVisualizationMarkdown>["blocks"])`: remark plugin resolving internal placeholders to dedicated nodes carrying the source and pending status.

- [ ] Write failing schema and extraction tests. Include these exact expectations:

```ts
expect(parseVisualizationSettings('{"type":"Plotly.js","data":[]}').success).toBe(false)
expect(parseVisualizationSettings('{"type":"Plotly.js","data":[{"type":"scatter","x":[0,1],"y":[0,1]}]}').success).toBe(true)
expect(parseVisualizationSettings(" ".repeat(500_001)).success).toBe(false)
```

Also assert missing/unsupported providers, non-object traces, non-JSON numbers, 51 traces, malformed JSON, and unknown config keys fail. Assert optional layout/config defaults, 50 traces, surface/heatmap arrays, annotations, and `\u0027` labels succeed. Reject `layout.images` sources, image-trace `source`, trace/marker image URL fields, remote `*src` reference fields, cloud config, and external map/geo rendering that requires remote assets. Preserve ordinary colorscale/text/layout JSON.

- [ ] Write extraction tests asserting multiple plots retain ordering; multi-line JSON/CRLF parse; `/>` inside strings does not terminate; code examples stay byte-identical; partial tags/attributes produce one pending block; trailing Markdown after a completed tag survives. Cover inline code, indented code, nested/list fences, longer closing fences, and incomplete fences. An internal-marker-looking string supplied by a user must not impersonate a generated plot.
- [ ] Run `pnpm --dir desktop exec vitest run tests/visualization.test.ts tests/visualization-markdown.test.ts`. Confirm failures are missing implementation/behavior, not fixture errors.
- [ ] Implement the schema and a quote-aware block scanner. Scan outside Markdown code contexts, require standalone elements, and retain an unfinished visualization through end-of-input as pending. Use an extraction namespace guaranteed absent from the original input; resolve only its registered nodes. Preserve raw source separately for error disclosure. Keep JSON out of all existing text normalizers by replacing complete and partial blocks before preprocessing.
- [ ] Validate local config keys `displayModeBar` (boolean or `hover`), `scrollZoom`, `displaylogo`, and `locale` only. Force responsive behavior in the runtime. Reject nonlocal assets/services instead of silently permitting external network requests. Validate finite JSON numbers recursively.
- [ ] Run the two focused files; expect PASS. Review the source and settings types for unchecked raw-JSON casts and accidental general HTML handling.

### Task 2: Plotly runtime and interactive component

**Interfaces:**
- Consumes Task 1's `parseVisualizationSettings` result and inferred schema types.
- `loadPlotly()`: lazy shared import of `plotly.js-strict-dist-min`, inferred as the upstream Plotly module.
- `PlotlyVisualization({ source, pending = false, magnifiable = true })`: `source: string`, optional boolean flags; renders loading, chart, or recoverable error.
- Runtime validates trace types against `Plotly.PlotSchema.get()` before calling `Plotly.react`; no hand-maintained replacement trace enum.

- [ ] Add failing lifecycle tests using a DOM test environment scoped to `visualization-lifecycle.test.ts`, with a mocked Plotly module and controllable import/render promises. If no existing DOM test dependency is available, add `happy-dom` with pnpm as part of this task. Assert pending/invalid inputs never load Plotly, replacements serialize chart updates, rejected renders show source fallback, cleanup disconnects observers and purges, and late completions never set a stale ready state. Test cleanup while an old render is pending and while an expanded dialog is closed.
- [ ] Run `pnpm --dir desktop exec vitest run tests/visualization-lifecycle.test.ts`; confirm the new behavior fails before implementation.
- [ ] Install with `pnpm --dir desktop add plotly.js-strict-dist-min` and `pnpm --dir desktop add -D @types/plotly.js`. Use the strict bundle to retain the current script CSP while supporting the required 3D traces. Add a module declaration using the upstream API only if needed. Reference: [official bundle documentation](https://github.com/plotly/plotly.js/blob/main/dist/README.md#plotlyjs-strict).
- [ ] Implement the runtime boundary: preserve validated JSON, reject unknown trace names, and adapt through checked schema/library boundaries. Inspect the installed types before introducing aliases. Clone input objects before Plotly can mutate them. Remove fixed width, clamp height, force autosize/responsive, and remove upload controls from the mode bar. Disallow `staticPlot` so the element remains interactive.
- [ ] Implement the component using an effect for the imperative library, a per-instance serialized render queue, cancellation guards, `ResizeObserver`, and purge after in-flight cleanup. A new chart can mount while its predecessor is finishing, so isolate target DOM nodes per render lifetime. Use theme observation consistent with `MermaidDiagram`; set stable `uirevision` for the same source, preserving user camera and axis state through resize/theme changes.
- [ ] Add title-derived accessible labels, visible status messages, and local error UI with an expandable source `<details>`. Set the exact pending copy to “Preparing visualization…”. Add a separate “Expand visualization” button through `MediaPreview`; render an independent `magnifiable={false}` chart inside it. The plot surface must not open the dialog on drag/click.
- [ ] Test empty/long titles, explicit teaching colors, default/clamped heights, immutable input, unknown trace names, theme updates preserving `uirevision`, rejected import, and unavailable WebGL/error events. Confirm plot failure is local to its figure.
- [ ] Run focused schema/lifecycle tests and `pnpm --dir desktop typecheck`; expect PASS.

### Task 3: Markdown rendering and tutor instructions

**Interfaces:** Consumes `prepareVisualizationMarkdown`, `visualizationMarkdown`, `PlotlyVisualization`, and `visualizationInstructions` from Tasks 1–2; retains all existing `StudyMarkdown` props and tutor-session return fields.

- [ ] Extend `desktop/tests/markdown.test.ts` with a mock visualization component, as for Mermaid. Assert complete/pending plots are routed to it, JSON is exact after preprocessing, surrounding paragraphs retain formatting, multiple plots appear in order, example code stays literal, unknown HTML is skipped, and plots are not wrapped in `<pre>` or invalid paragraph nesting. Include strings containing `\(x\)`, `Sourced from: Lecture.pdf, pg. 2`, apostrophes, and `<`/`>` with actual material aliases supplied.
- [ ] Extend `desktop/tests/tutor.test.ts` with `createTutorSession(job(), () => {})` assertions that instructions include the canonical element, `Plotly.js`, 2D/3D examples, matrix/transformation guidance, saved-summary use, source-image guidance, and the instruction to distinguish illustrative data. Assert the declared examples pass `parseVisualizationSettings` after extraction.
- [ ] Run `pnpm --dir desktop exec vitest run tests/markdown.test.ts tests/tutor.test.ts`; confirm only the new expectations fail.
- [ ] Integrate the preparation pass before `linkSourceCitations` and `normalizeMathDelimiters`; register the scoped remark transformer and component, retaining `skipHtml`. Render internal nodes only when their keys resolve to the current preparation result. Keep block identity stable so appending streamed prose does not remount unchanged figures.
- [ ] Include shared guidance in `createTutorSession` without adding tools. Explain sampled coordinates, labels/units/ranges, illustrative versus source data, observing the graph, and using plots when they aid understanding. Preserve current question/answer-key and source-citation rules.
- [ ] Run the focused Markdown/tutor/visualization tests and typecheck; expect PASS. Verify chat replies and topic notes both use the updated `StudyMarkdown` without a parallel rendering path.

### Task 4: Electron interaction, persistence, and production verification

**Interfaces:** Existing `WorkspaceRepository`, `newChat`, `newTopic`, provider fixture setup, Electron launch, and `window.prune` snapshot patterns from `desktop/tests/message-images.smoke.ts`; no new production test-only route.

- [ ] Create an isolated-workspace smoke fixture with saved assistant Markdown containing a 2D line, matrix heatmap, and 3D surface. Add a topic summary containing the same element and valid existing topic directory. Follow repository schemas when constructing saved records, preserving onboarding/provider configuration from existing smoke fixtures.
- [ ] Add browser assertions: visible SVG line plot; hover tooltip; axis-range change after zoom/pan; 3D canvas with changed camera after drag; heatmap rendered; expansion opens only via the named button; dialog closes; plots survive reload and topic-note navigation. Assert a malformed plot shows its fallback while the adjacent valid plot still renders.
- [ ] Capture console/page errors and CSP violations. Assert no external plot requests, no `unsafe-eval` failures, and no global Plotly load in a chat without figures. Test narrow viewport, long title, theme toggle, container resize, and repeated navigation/expansion without accumulating plot DOM nodes. Capture representative 2D and 3D screenshots for visual inspection.
- [ ] Build with `pnpm --dir desktop build`, then run `pnpm --dir desktop exec playwright test tests/visualizations.smoke.ts`. Inspect screenshots. Both 2D and 3D must actually render under the packaged renderer CSP; do not count a fallback as a successful 3D check. If the host lacks WebGL, verify on a WebGL-capable browser/runtime before claiming that criterion passes.
- [ ] Run `pnpm --dir desktop test`, `pnpm --dir desktop typecheck`, and `git diff --check`. Record pre-existing failures separately with reproduction evidence; fix regressions in changed behavior. Repeat build/smoke only if subsequent fixes affect it.
- [ ] Review the full diff against the spec, verify no raw-HTML execution or unchecked JSON typecast was added, and report changed behavior, verification evidence, limitations, and materially relevant AGENTS.md rules. No commits, publishing, or PR creation are part of this plan unless the user requests them.

## Plan Review and Execution

Self-review: all spec sections map to Tasks 1–4; review-focus cases have explicit tests above. Parsing remains independent of the browser-only Plotly import. The existing CSP requires the strict bundle, and existing text persistence avoids a migration. Browser smoke verification covers lifecycle/UI behaviors that server-rendered Markdown tests cannot prove.

Recommended execution: native, inline implementation. These four tasks share the parsing and rendering interfaces closely; keeping one implementation context avoids repeated handoffs. Request a fresh final reviewer under the selected execution skill, after the regression checks pass.

## Execution ledger

Implemented inline on `feat/plotly-visualizations`, preserving the checkout's unrelated existing edits. No commits, push, or PR.

- Task 1 complete: Zod contract and opaque Markdown extraction, protected code contexts, partial streams, and source preservation.
- Task 2 complete: lazy strict Plotly distribution, validated trace names, responsive/themed rendering, error recovery, expansion, and queued lifecycle cleanup.
- Task 3 complete: chat/topic Markdown integration and provider-independent tutor guidance. A failing streaming regression exposed remounts; a stable context-backed renderer preserves existing figures.
- Task 4 complete: 325 unit tests passed, 2 live integration tests skipped; typecheck and production build passed; Electron smoke passed, including 2D hover/zoom, heatmap, 3D rotation, repeated expansion, theme, narrow viewport, reload, saved notes, and long titles. Console and external-request checks passed. Inspected 2D/3D screenshots.

Independent gpt-6-astra review found one Important issue: choropleth traces could fetch geographic topology. Added a failing regression, rejected that trace alongside other remote-dependent geographic types, and reran the full suite successfully. No deferred minors.

Runtime adjustments: the strict distribution retains script CSP restrictions; embedded Plotly WOFF2 fonts require `data:` in `font-src`, verified by a previously failing Electron console check. Markdown's existing parser identifies code/HTML protection ranges before extraction. Upstream library types are reused after Zod validation, with a small declaration for the strict distribution's otherwise untyped module.
