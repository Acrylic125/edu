import { flushSync } from "react-dom"
import type { Root } from "react-dom/client"
import { ChatConversation } from "@edu/ui/chat"
import { useChatScroll } from "../../src/renderer/chat-scroll"

function Conversation({ chatId }: { chatId: string }) {
  const ref = useChatScroll(chatId)
  return <div id="scroll-fixture" style={{ height: 300, width: 600 }}>
    <style>{`
      #scroll-fixture [data-slot="scroll-area"] { height: 100%; }
      #scroll-fixture [data-slot="scroll-area-viewport"] { height: 100%; overflow: auto; }
      #scroll-fixture [data-slot="scroll-area-content"] { display: flex; flex-direction: column; min-height: 100%; }
    `}</style>
    <ChatConversation ref={ref}>
      <div style={{ height: 1000, flexShrink: 0 }}>Earlier messages</div>
      <div id="delayed-visual" style={{ height: 40, flexShrink: 0 }}>Loading visual</div>
    </ChatConversation>
  </div>
}

async function settle() {
  for (let frame = 0; frame < 4; frame++) {
    await new Promise(requestAnimationFrame)
  }
}

export async function testChatScroll(root: Root, host: HTMLElement) {
  const chatId = `scroll-test-${crypto.randomUUID()}`
  flushSync(() => root.render(<Conversation chatId={chatId} />))
  const viewport = host.querySelector<HTMLDivElement>('[role="log"]')!
  const visual = host.querySelector<HTMLDivElement>("#delayed-visual")!
  const assertBottom = (label: string) => {
    const gap = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
    if (gap > 2) throw new Error(`${label}: conversation is ${gap}px above bottom`)
  }
  assertBottom("Initial conversation")

  // An initial scroll event can still be queued when a cached visual loads.
  visual.style.height = "800px"
  await settle()
  assertBottom("Visual loads while opening conversation")

  visual.style.height = "40px"
  await settle()
  assertBottom("Visual placeholder shrinks")
  visual.style.height = "800px"
  await settle()
  assertBottom("Delayed visual growth")

  viewport.scrollTop -= 200
  await settle()
  const readingTop = viewport.scrollTop
  visual.style.height = "1000px"
  await settle()
  if (viewport.scrollTop !== readingTop) throw new Error("Visual growth must preserve the position when reading earlier messages")

  viewport.scrollTop += 50
  await settle()
  const nextReadingTop = viewport.scrollTop
  visual.style.height = "1200px"
  await settle()
  if (viewport.scrollTop !== nextReadingTop) throw new Error("Scrolling down within history must not resume bottom-following")

  viewport.scrollTop = viewport.scrollHeight
  visual.style.height = "1400px"
  await settle()
  assertBottom("Visual loads while returning to bottom")

  for (let update = 0; update < 10; update++) {
    visual.style.height = `${1500 + update * 50}px`
    await settle()
    assertBottom("Repeated visual updates")
  }

  viewport.style.height = "200px"
  await settle()
  assertBottom("Conversation viewport resizes")

  flushSync(() => root.render(null))
  localStorage.removeItem(`edu:chat-scroll:${chatId}`)
  console.log("PASS: chat follows delayed visuals and preserves manual scroll position")
}
