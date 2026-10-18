import { useCallback, useLayoutEffect, useRef } from "react"
import { z } from "zod"

const ScrollPositionSchema = z.object({
  top: z.number().nonnegative(),
  atBottom: z.boolean(),
})

export function useChatScroll(chatId: string) {
  const viewport = useRef<HTMLDivElement | null>(null)
  const atBottom = useRef(true)
  const followBottom = useCallback(() => {
    const element = viewport.current
    if (element && atBottom.current) element.scrollTop = element.scrollHeight
  }, [])

  const ref = useCallback((element: HTMLDivElement | null) => {
    viewport.current = element
    if (!element) return
    let saved = ScrollPositionSchema.parse({ top: 0, atBottom: true })
    try {
      const raw = localStorage.getItem(`edu:chat-scroll:${chatId}`)
      if (raw) saved = ScrollPositionSchema.parse(JSON.parse(raw))
    } catch {
      // Storage failure must not prevent opening a conversation.
    }
    atBottom.current = saved.atBottom
    element.scrollTop = saved.top
    followBottom()

    function save() {
      if (!element) return
      atBottom.current = element.scrollHeight - element.clientHeight - element.scrollTop <= 2
      try {
        localStorage.setItem(`edu:chat-scroll:${chatId}`, JSON.stringify({
          top: element.scrollTop,
          atBottom: atBottom.current,
        }))
      } catch {
        // Conversation navigation remains available when storage is full or disabled.
      }
    }
    element.addEventListener("scroll", save)
    const observer = new ResizeObserver(followBottom)
    const content = element.querySelector('[data-slot="scroll-area-content"]')
    if (content) observer.observe(content)
    observer.observe(element)
    return () => {
      element.removeEventListener("scroll", save)
      observer.disconnect()
      viewport.current = null
    }
  }, [chatId, followBottom])

  // React and asynchronously rendered diagrams can both change the conversation height.
  useLayoutEffect(followBottom)
  return ref
}
