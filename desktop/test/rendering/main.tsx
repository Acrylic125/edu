import { testTestScratchpad } from "./test-scratchpad"
import { Profiler } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { StudyMarkdown } from "../../src/renderer/markdown"
import { App } from "../../src/renderer/workspace"
import { ProviderConnectionSetup } from "../../src/renderer/settings/settings"
import { useWorkspace } from "../../src/renderer/store"
import { useTopicViews } from "../../src/renderer/topic-views"
import { useChatTabs } from "../../src/renderer/chat-tabs"
import { SnapshotSchema } from "../../src/shared/contracts"
import { ThemeProvider } from "@edu/ui/theme"
import imageUrl from "./diagram.svg"
import { testChatAttachments } from "./chat-attachments"
import { testScratchpadMismatchBanner } from "./scratchpad-mismatch-banner"
import { testChatTabs } from "./chat-tabs"
import { testChatScroll } from "./chat-scroll"
import { testTopicTerminology } from "./topic-terminology"

const image = `![Example](<${new URL(imageUrl, location.href).pathname}>)`
const diagram = "```mermaid\ngraph LR\nA --> B\n```"
const plot = `<visualization settings='{"type":"Plotly.js","data":[{"type":"scatter","x":[1,2],"y":[2,4]}],"layout":{"title":"Example"}}' />`
const lesson = `## Derivatives\n\nThe slope is $f'(x) = 2x$.\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n\`\`\`ts\nconst slope = 2\n\`\`\`\n\n`.repeat(4)

async function waitFor(check: () => boolean) {
  const deadline = performance.now() + 15_000
  while (!check()) {
    if (performance.now() > deadline) throw new Error("Timed out waiting for rendered visuals")
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function runRenderingTests() {
  const host = document.getElementById("root")!
  const root = createRoot(host)
  await testChatAttachments(root, host)
  testTestScratchpad(root, host)
  await testScratchpadMismatchBanner(root, host)
  await testChatTabs(root, host)
  await testChatScroll(root, host)
  await testTopicTerminology(root, host)
  const durations: { actual: number; base: number }[] = []
  const failures: string[] = []
  function render(notes: string, reply = "Working") {
    flushSync(() => root.render(
      <Profiler id="workspace" onRender={(_id, _phase, actual, base) => durations.push({ actual, base })}>
        <section id="scratchpad"><StudyMarkdown text={notes} topics={[]} materials={[]} onOpenTopic={() => {}} onOpenMaterial={() => {}} /></section>
        <section id="chat">
          {Array.from({ length: 20 }, (_, index) => <StudyMarkdown key={index} text={lesson} topics={[]} materials={[]} onOpenTopic={() => {}} onOpenMaterial={() => {}} />)}
          <StudyMarkdown text={reply} topics={[]} materials={[]} onOpenTopic={() => {}} onOpenMaterial={() => {}} />
        </section>
      </Profiler>,
    ))
  }
  const notes = `${image}\n\n${diagram}\n\n${plot}\n\n${lesson}`
  render(notes)
  await waitFor(() => !!host.querySelector(".js-plotly-plot .main-svg") && !!host.querySelector('[aria-label="Mermaid diagram"] svg') && (host.querySelector<HTMLImageElement>("img")?.naturalWidth ?? 0) > 0)
  const originalImage = host.querySelector("#scratchpad img")
  const originalDiagram = host.querySelector('[aria-label="Mermaid diagram"] svg')
  const originalPlot = host.querySelector(".js-plotly-plot")
  const originalCode = host.querySelector("#chat code")
  const assert = (passed: boolean, message: string) => {
    if (!passed) failures.push(message)
  }
  const started = performance.now()
  const startCommit = durations.length
  for (let index = 0; index < 12; index++) render(notes, `Working ${index}`)
  const elapsed = performance.now() - started
  const commits = durations.slice(startCommit)
  const actual = commits.reduce((sum, commit) => sum + commit.actual, 0)
  const base = commits.reduce((sum, commit) => sum + commit.base, 0)
  assert(commits.length >= 12 && base > 0 && actual < base / 4, "Streaming must skip expensive rendering of unchanged Markdown (Profiler actual/base < 25%)")
  assert(host.querySelector("#scratchpad img") === originalImage, "Streaming chat must preserve scratchpad image nodes")
  assert(host.querySelector('[aria-label="Mermaid diagram"] svg') === originalDiagram, "Streaming chat must preserve scratchpad diagrams")
  assert(host.querySelector(".js-plotly-plot") === originalPlot, "Streaming chat must preserve scratchpad plots")
  assert(host.querySelector("#chat code") === originalCode, "Streaming must preserve completed message code nodes")
  render(`${notes}\n\nNew tutor notes.`)
  assert(host.querySelector("#scratchpad img") === originalImage, "Committing text must preserve unchanged scratchpad images")
  assert(host.querySelector('[aria-label="Mermaid diagram"] svg') === originalDiagram, "Committing text must preserve unchanged scratchpad diagrams")
  assert(host.querySelector(".js-plotly-plot") === originalPlot, "Committing text must preserve unchanged scratchpad plots")
  assert(host.textContent?.includes("New tutor notes.") === true, "Committed text must still update")

  flushSync(() => host.querySelector<HTMLImageElement>("#scratchpad img")!.click())
  const preview = document.querySelector("dialog")
  render(`${notes}\n\nMore tutor notes.`)
  assert(preview !== null && document.querySelector("dialog") === preview && preview.open, "Scratchpad commits must preserve an open image preview")
  preview?.close()

  console.log(`Rendering benchmark: 12 streaming updates across 20 math/code messages: ${elapsed.toFixed(1)} ms`)
  console.log(`Profiler: actual ${actual.toFixed(1)} ms / base ${base.toFixed(1)} ms`)

  const topicId = crypto.randomUUID()
  const materialId = crypto.randomUUID()
  const references = `[Related](edu-topic://${topicId})\n\n[Source](edu-material://${materialId}/1)\n\n**Check:** Explain the slope.`
  let opened = ""
  function renderReferences(title: string, name: string, showSourcePreviews: boolean, checkLabel: string) {
    flushSync(() => root.render(<StudyMarkdown
      text={references}
      topics={[{ id: topicId, title }]}
      materials={[{ id: materialId, name, kind: "pdf" }]}
      onOpenTopic={(id) => { opened = `${title}:${id}` }}
      onOpenMaterial={(id) => { opened = `${name}:${id}` }}
      showSourcePreviews={showSourcePreviews}
      checkLabel={checkLabel}
    />))
  }
  renderReferences("Old topic", "old.pdf", false, "Check your understanding")
  const topicLink = host.querySelector<HTMLButtonElement>(".markdown button")!
  renderReferences("New topic", "old.pdf", false, "TEST")
  assert(host.querySelector(".markdown button") === topicLink && topicLink.textContent === "@New topic", "Topic labels must update without reparsing or replacing links")
  topicLink.click()
  assert(opened === `New topic:${topicId}`, "Memoized Markdown must use current topic callbacks")
  assert(host.querySelector('section[aria-label="TEST"]') !== null, "Understanding-check labels must update through memoized Markdown")
  renderReferences("New topic", "new.pdf", true, "TEST")
  assert(host.querySelector(`img[src="prune-source://${materialId}/1"]`) !== null, "Source preview changes must invalidate Markdown")
  const sourceLink = host.querySelector<HTMLAnchorElement>(`a[href="edu-material://${materialId}/1"]`)!
  assert(sourceLink.title === "new.pdf", "Material metadata must update")
  sourceLink.click()
  assert(opened === `new.pdf:${materialId}`, "Memoized Markdown must use current material callbacks")

  const chatId = crypto.randomUUID()
  const runnerId = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const snapshot = SnapshotSchema.parse({
    runners: [{ id: runnerId, name: "Tutor", provider: "codex", model: "test" }],
    topics: [{
      id: topicId, title: "Derivatives", createdAt, planConfirmed: true, materials: [],
      learning: { phase: "ready_to_continue", outline: [], currentSection: "", pendingQuestion: "", nextAction: "", notes },
    }],
    chats: [{
      id: chatId, title: "Derivatives", createdAt, runnerId, phase: "ready_to_continue", materials: [],
      messages: Array.from({ length: 20 }, () => ({ id: crypto.randomUUID(), role: "assistant", content: lesson, createdAt })),
    }],
    runtime: [{ runnerId, chatId, status: "running", activity: "Thinking", reply: "Working" }],
    connected: true,
    providers: [{ id: "codex", name: "Codex", connected: true, installed: true, models: [] }],
  })
  flushSync(() => {
    useWorkspace.getState().setSnapshot(snapshot)
    useTopicViews.getState().select(topicId)
    useChatTabs.getState().select(chatId)
    root.render(<ThemeProvider><App /></ThemeProvider>)
  })
  await waitFor(() => !!host.querySelector(".js-plotly-plot .main-svg") && !!host.querySelector('[aria-label="Mermaid diagram"] svg'))
  const workspaceImage = host.querySelector(".study-document img")
  const workspaceDiagram = host.querySelector('[aria-label="Mermaid diagram"] svg')
  const workspacePlot = host.querySelector(".js-plotly-plot")
  const workspaceStarted = performance.now()
  for (let index = 0; index < 12; index++) {
    const next = structuredClone(snapshot)
    next.runtime[0].reply = `Working ${index}`
    flushSync(() => useWorkspace.getState().setSnapshot(next))
  }
  const workspaceElapsed = performance.now() - workspaceStarted
  const committed = structuredClone(snapshot)
  committed.topics[0].learning.notes += "\n\nCommitted lesson."
  flushSync(() => useWorkspace.getState().setSnapshot(committed))
  assert(workspaceImage !== null && host.querySelector(".study-document img") === workspaceImage, "Full workspace snapshots and commits must preserve scratchpad images")
  assert(host.querySelector('[aria-label="Mermaid diagram"] svg') === workspaceDiagram, "Full workspace snapshots and commits must preserve scratchpad diagrams")
  assert(host.querySelector(".js-plotly-plot") === workspacePlot, "Full workspace snapshots and commits must preserve scratchpad plots")
  assert(host.textContent?.includes("Committed lesson.") === true, "Full workspace commits must show updated content")
  console.log(`Full workspace benchmark: 12 IPC-style snapshots across 20 messages: ${workspaceElapsed.toFixed(1)} ms`)

  for (const [source, label] of [["installed", "Installed Codex"], ["custom", "Custom binary"]] as const) {
    const next = SnapshotSchema.parse({
      ...snapshot,
      providers: [{ ...snapshot.providers[0], runtime: { source, executable: "/example/codex/bin/codex" } }],
    })
    flushSync(() => root.render(<ThemeProvider><ProviderConnectionSetup snapshot={next} /></ThemeProvider>))
    const runtime = host.querySelector('[aria-label="Codex runtime"]')
    assert(runtime?.textContent?.includes(label) === true, `Codex settings must show the ${source} runtime source`)
    assert(runtime?.textContent?.includes("/example/codex/bin/codex") === true, "Codex settings must show the actual executable path")
    assert(runtime?.closest("details") === null, "Runtime details must be visible without opening advanced settings")
  }
  for (const [id, name, label] of [["claude", "Claude", "Installed Claude Code"], ["antigravity", "Antigravity", "Installed Antigravity CLI"]] as const) {
    const next = SnapshotSchema.parse({ ...snapshot, providers: [{
      id, name, connected: false, installed: true, models: [],
      runtime: { source: "installed", executable: `/example/bin/${id}` },
    }] })
    flushSync(() => root.render(<ThemeProvider><ProviderConnectionSetup snapshot={next} /></ThemeProvider>))
    const runtime = host.querySelector(`[aria-label="${name} runtime"]`)
    assert(runtime?.textContent?.includes(label) === true, `${name} settings must show the installation source`)
    assert(runtime?.textContent?.includes(`/example/bin/${id}`) === true, `${name} settings must show the executable path before connecting`)
    delete next.providers[0].runtime
    flushSync(() => root.render(<ThemeProvider><ProviderConnectionSetup snapshot={next} /></ThemeProvider>))
    assert(host.querySelector(`[aria-label="${name} runtime"]`)?.textContent?.includes("Not detected") === true, `${name} settings must explain when no executable is found`)
  }

  for (const failure of failures) console.error(`FAIL: ${failure}`)
  root.unmount()
  if (failures.length) throw new Error(`${failures.length} rendering regressions`)
  console.log("PASS: streaming and scratchpad commits preserve images, diagrams, plots, and completed messages")
}

declare global {
  interface Window {
    renderingTests: ReturnType<typeof runRenderingTests>
  }
}

window.renderingTests = runRenderingTests()
