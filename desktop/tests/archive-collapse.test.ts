// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react"
import { createRoot } from "react-dom/client"
import { expect, test, vi } from "vitest"
import { DesktopSidebar } from "../src/renderer/workspace"
import { SnapshotSchema } from "../src/shared/contracts"

vi.mock("@edu/ui/workspace", async (importOriginal) => ({
  ...await importOriginal<typeof import("@edu/ui/workspace")>(),
  useWorkspaceLayout: () => ({ closeNavigation: vi.fn(), revealChat: vi.fn() }),
  WorkspaceSidebar: ({ children }: ComponentProps<"div">) => createElement("div", null, children),
}))

vi.mock("@edu/ui/context-menu", () => {
  const Container = ({ children }: ComponentProps<"div">) => createElement("div", null, children)
  return { ContextMenu: Container, ContextMenuTrigger: Container, ContextMenuContent: () => null,
    ContextMenuItem: Container, ContextMenuSeparator: () => null }
})

test("an archived selection can be collapsed and stays collapsed across snapshot updates", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const topicId = "12345678-1234-4234-8234-123456789abc"
  const snapshot = SnapshotSchema.parse({
    runners: [], chats: [], runtime: [], connected: true, providers: [],
    topics: [{ id: topicId, title: "Archived notes", archived: true,
      createdAt: "2026-01-01T00:00:00.000Z", planConfirmed: false, materials: [],
      learning: { phase: "awaiting_plan_confirmation", outline: [], currentSection: "", pendingQuestion: "", nextAction: "", notes: "" } }],
  })
  const render = async (selected = topicId) => {
    await act(async () => root.render(createElement(DesktopSidebar, {
      snapshot: { ...snapshot, topics: [...snapshot.topics] }, topicId: selected, view: "learn", busy: false,
      onOpenTopic: vi.fn(), onOpenSettings: vi.fn(), onTagTopic: vi.fn(), onArchiveTopic: vi.fn(), onCopyTopicId: vi.fn(),
    })))
  }
  try {
    await render()
    const trigger = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Archived"))!
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    await act(async () => trigger.click())
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    await render()
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    await render("")
    await render()
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
  } finally {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
})
