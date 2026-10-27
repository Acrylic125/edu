import { flushSync } from "react-dom"
import type { Root } from "react-dom/client"
import { ChatSessions } from "@edu/ui/chat"
import { createChatTabs } from "../../src/renderer/chat-tabs"

async function settle() {
  for (let frame = 0; frame < 4; frame++) await new Promise(requestAnimationFrame)
}

export async function testChatTabs(root: Root, host: HTMLElement) {
  const sessions = Array.from({ length: 20 }, (_, index) => ({ id: `chat-${index}`, title: `Thread ${index}` }))
  const store = createChatTabs()
  store.getState().reconcile(sessions.map((session) => session.id))
  store.getState().select(sessions.at(-1)!.id)
  function Fixture() {
    const tabs = store()
    return <div id="tabs-fixture" style={{ width: 600, height: 300 }}>
      <style>{`
        #tabs-fixture [role="tablist"] { width: 500px; overflow-x: auto; }
        #tabs-fixture [role="tablist"] > div { position: relative; height: 32px; }
        #tabs-fixture [role="tablist"] > div > div { position: absolute; left: 0; top: 0; height: 32px; }
      `}</style>
      <ChatSessions sessions={sessions} openIds={tabs.openIds ?? []} activeId={tabs.activeId}
        onSelect={tabs.select} onNew={() => tabs.select("new")} onClose={tabs.close}>
        <p>Conversation</p>
      </ChatSessions>
    </div>
  }
  flushSync(() => root.render(<Fixture />))
  await settle()
  const strip = host.querySelector<HTMLDivElement>('[role="tablist"]')!
  strip.scrollLeft = 0
  await settle()
  const survivingTab = host.querySelector('[role="tab"][title="Thread 1"]')
  const close = host.querySelector<HTMLButtonElement>('[aria-label="Close Thread 0"]')!
  flushSync(() => close.click())
  await settle()
  if (strip.scrollLeft > 1) throw new Error(`Closing the leftmost tab shifted the strip right by ${strip.scrollLeft}px`)
  if (host.querySelector('[role="tab"][title="Thread 1"]') !== survivingTab) throw new Error("Closing a tab must preserve surviving tab nodes")
  flushSync(() => store.getState().select("chat-1"))
  await settle()
  const activeClose = host.querySelector<HTMLButtonElement>('[aria-label="Close Thread 1"]')!
  activeClose.focus({ preventScroll: true })
  flushSync(() => activeClose.click())
  await settle()
  if (strip.scrollLeft > 1) throw new Error("Closing the active leftmost tab must not reveal a distant MRU tab")
  if (document.activeElement?.getAttribute("aria-selected") !== "true") throw new Error("Closing a focused tab must restore focus to the surviving active tab")
  flushSync(() => store.getState().select("chat-15"))
  await settle()
  if (strip.scrollLeft < 1) throw new Error("Selecting an offscreen thread must reveal its tab")
  flushSync(() => root.render(null))
  console.log("PASS: closing leftmost tabs preserves scroll and selecting threads reveals them")
}
