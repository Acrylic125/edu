import { flushSync } from "react-dom"
import type { Root } from "react-dom/client"
import { ThemeProvider } from "@edu/ui/theme"
import { App } from "../../src/renderer/workspace"
import { initializeWorkspace } from "../../src/renderer/store"
import { useTopicViews } from "../../src/renderer/topic-views"
import { PublicTopicSchema, ReconcileScratchpadSchema, SnapshotSchema } from "../../src/shared/contracts"
import { z } from "zod"

async function settle() {
  for (let frame = 0; frame < 4; frame++) await new Promise(requestAnimationFrame)
}

export async function testScratchpadFiles(root: Root, host: HTMLElement) {
  const original = window.edu
  const createdAt = new Date().toISOString()
  const runnerId = crypto.randomUUID()
  const scratchpads = [undefined, "missing-markdown", "missing-state", "missing-both"].map((fileError, index) => PublicTopicSchema.parse({
    id: crypto.randomUUID(), title: `Scratchpad ${index + 1}`, fileError, createdAt, planConfirmed: true, materials: [],
    state: index < 2 ? { type: "generic", version: "19-10-2026", createdAt, name: `Scratchpad ${index + 1}`, references: [] } : undefined,
    learning: { phase: "ready_to_continue", outline: [], currentSection: "", pendingQuestion: "", nextAction: "", notes: "# Existing notes\n\nPreserve this Markdown." },
  }))
  const snapshot = SnapshotSchema.parse({
    scratchpads, runners: [{ id: runnerId, name: "Tutor", provider: "codex", model: "test" }], runtime: [], connected: true,
    providers: [{ id: "codex", name: "Codex", installed: true, connected: true, models: [] }],
    chats: scratchpads.map((scratchpad) => ({
      id: crypto.randomUUID(), runnerId, ownerScratchpadId: scratchpad.id, title: "Existing thread", createdAt, materials: [], phase: "ready_to_continue",
      messages: [{ id: crypto.randomUUID(), role: "assistant", content: "Existing conversation stays visible.", createdAt }],
    })),
  })
  const actions: z.infer<typeof ReconcileScratchpadSchema>[] = []
  let receiveSnapshot = (_snapshot: z.infer<typeof SnapshotSchema>) => {}
  window.edu = {
    ...original!, snapshot: async () => structuredClone(snapshot),
    subscribe: (listener) => { receiveSnapshot = listener; return () => {} },
    subscribeRuntime: () => () => {},
    reconcileScratchpad: async (input) => {
      actions.push(input)
      const scratchpad = snapshot.scratchpads.find((item) => item.id === input.scratchpadId)!
      scratchpad.fileError = undefined
      if (input.action === "convert-to-generic") scratchpad.state = { type: "generic", version: "19-10-2026", createdAt, name: scratchpad.title, references: [] }
      flushSync(() => receiveSnapshot(structuredClone(snapshot)))
    },
  }
  function button(label: string) {
    return Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.trim() === label)
  }
  async function open(index: number) {
    flushSync(() => useTopicViews.getState().select(scratchpads[index].id))
    await settle()
  }
  try {
    await initializeWorkspace()
    flushSync(() => {
      useTopicViews.getState().select(scratchpads[0].id)
      root.render(<ThemeProvider><App /></ThemeProvider>)
    })
    await settle()
    if (host.querySelector('[role="alert"]')) throw new Error("Healthy scratchpads must not show a file error")
    await open(1)
    const navigation = host.querySelector('nav[aria-label="Your scratchpads"]')!
    const errors = Array.from(navigation.querySelectorAll<HTMLButtonElement>("button")).filter((item) => item.querySelector('[data-slot="badge"]')?.textContent === "Error")
    if (errors.length !== 3 || errors.some((item) => !item.classList.contains("bg-destructive/8") && !item.classList.contains("bg-destructive/16"))) throw new Error("Every damaged scratchpad needs a destructive selector entry and Error badge")
    if (!host.textContent?.includes("ERROR! Missing scratchpad.md") || !button("Regenerate")) throw new Error("Missing Markdown must offer regeneration")
    if (host.textContent?.includes("Preserve this Markdown.")) throw new Error("Missing Markdown must not render cached document content")
    if (!host.textContent?.includes("Existing conversation stays visible.")) throw new Error("Damaged scratchpads must retain their threads")
    flushSync(() => button("Regenerate")!.click())
    await settle()
    if (actions[0]?.scratchpadId !== scratchpads[1].id || actions[0].action !== "regenerate" || host.querySelector('[role="alert"]')) throw new Error("Regenerate must target the selected scratchpad and clear its error")
    await open(2)
    if (!host.textContent?.includes("Scratchpad state file is missing. We cannot recover this. Convert to Generic Scratchpad?") || !host.textContent?.includes("Preserve this Markdown.")) throw new Error("Missing state must show its banner and surviving Markdown")
    flushSync(() => button("Convert to generic scratchpad")!.click())
    await settle()
    if (actions[1]?.scratchpadId !== scratchpads[2].id || actions[1].action !== "convert-to-generic" || host.querySelector('[role="alert"]')) throw new Error("Conversion must target the selected scratchpad and clear its error")
    if (!host.textContent?.includes("Preserve this Markdown.")) throw new Error("Conversion must preserve Markdown in the UI")
    await open(3)
    if (!host.textContent?.includes("Missing scratchpad.md") || !host.textContent?.includes("Cannot reconcile scratchpad, missing scratchpad.state.json")) throw new Error("Both missing files must show the unrecoverable error")
    if (button("Regenerate") || button("Convert to generic scratchpad")) throw new Error("Both missing files must not offer recovery")
    if (host.textContent?.includes("Preserve this Markdown.")) throw new Error("Both missing files must not render stale notes")
    console.log("PASS: scratchpad file errors preserve entries and threads, expose the correct recovery actions, and clear after recovery")
  } finally {
    window.edu = original
    flushSync(() => root.render(null))
  }
}
