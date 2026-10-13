"use client"

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import { MenuIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react"

import { Button } from "../primitives/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "../primitives/dialog"
import { cn } from "../utils"

export function restoreChatFocus(force = false) {
  // Switching panes can remove the dialog trigger or editor before the destination tab bar mounts.
  window.requestAnimationFrame(() => {
    if (force || document.activeElement === document.body) {
      const target =
        document.querySelector<HTMLButtonElement>(
          '[data-chat-context] [role="tab"][aria-selected="true"]',
        ) ??
        document.querySelector<HTMLElement>(
          '[data-chat-context] [role="tablist"]',
        )
      target?.focus({ preventScroll: true })
    }
  })
}

export function ChatSessions({
  sessions,
  openIds,
  activeId,
  onSelect,
  onNew,
  onClose,
  children,
}: {
  sessions: { id: string; title: string }[]
  openIds: string[]
  activeId?: string
  onSelect: (id: string) => void
  onNew: () => void
  onClose: (id: string) => void
  children: ReactNode
}) {
  const value = activeId ?? "new"
  const panelId = useId()
  const scroll = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const sessionById = new Map(sessions.map((session) => [session.id, session]))
  const tabs = openIds.flatMap((id) => {
    if (id === "new") return []
    const session = sessionById.get(id)
    return session ? [session] : []
  })
  if (value === "new" || openIds.includes("new"))
    tabs.push({ id: "new", title: "New chat" })
  const activeIndex = tabs.findIndex((tab) => tab.id === value)
  const virtualizer = useVirtualizer({
    horizontal: true,
    count: tabs.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 144,
    getItemKey: (index) => tabs[index].id,
    gap: 4,
    overscan: 2,
    rangeExtractor: (range) => {
      const indices = defaultRangeExtractor(range)
      if (activeIndex >= 0 && !indices.includes(activeIndex))
        indices.push(activeIndex)
      return indices.sort((a, b) => a - b)
    },
    initialOffset: Math.max(0, activeIndex) * 148,
  })

  useLayoutEffect(() => {
    if (activeIndex >= 0)
      virtualizer.scrollToIndex(activeIndex, { align: "auto" })
    if (pendingFocus.current === value || pendingFocus.current === "closed") {
      const button = scroll.current?.querySelector<HTMLButtonElement>(
        '[role="tab"][aria-selected="true"]',
      )
      if (button) {
        button.focus({ preventScroll: true })
        pendingFocus.current = null
      }
    }
  }, [activeIndex, value, virtualizer])

  function select(id: string) {
    if (id === "new") onNew()
    else onSelect(id)
  }

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length
    else if (event.key === "ArrowLeft")
      next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === "Home") next = 0
    else if (event.key === "End") next = tabs.length - 1
    else if (event.key === "Delete") {
      event.preventDefault()
      close(tabs[index].id)
      return
    } else return
    event.preventDefault()
    pendingFocus.current = tabs[next].id
    select(tabs[next].id)
    virtualizer.scrollToIndex(next, { align: "auto" })
  }

  function close(id: string) {
    // Keep keyboard focus in the tab strip when its focused control is removed.
    if (scroll.current?.contains(document.activeElement))
      pendingFocus.current = "closed"
    onClose(id)
  }

  return (
    <div data-chat-context className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-sidebar-border px-3">
        <div
          ref={scroll}
          role="tablist"
          tabIndex={-1}
          aria-label="Chat sessions"
          aria-orientation="horizontal"
          className="min-w-0 flex-1 overflow-x-auto py-2 outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div
            className="relative h-8"
            style={{ width: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const tab = tabs[item.index]
              const title = tab.title || "Untitled chat"
              return (
                <div
                  key={tab.id}
                  className="group absolute left-0 top-0 h-8"
                  style={{
                    width: item.size,
                    transform: `translateX(${item.start}px)`,
                  }}
                >
                  <button
                    ref={(element) => {
                      if (
                        element &&
                        (pendingFocus.current === tab.id ||
                          (pendingFocus.current === "closed" &&
                            tab.id === value))
                      ) {
                        element.focus({ preventScroll: true })
                        pendingFocus.current = null
                      }
                    }}
                    type="button"
                    role="tab"
                    id={`${panelId}-${tab.id}`}
                    aria-controls={panelId}
                    aria-selected={tab.id === value}
                    tabIndex={tab.id === value ? 0 : -1}
                    title={title}
                    className={cn(
                      "h-full w-full truncate rounded-full py-2 pl-3 pr-8 text-left text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      tab.id === value &&
                        "bg-accent font-medium text-foreground",
                    )}
                    onClick={() => select(tab.id)}
                    onKeyDown={(event) => navigate(event, item.index)}
                  >
                    {title}
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${title}`}
                    title={`Close ${title}`}
                    tabIndex={tab.id === value ? 0 : -1}
                    className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full text-muted-foreground opacity-0 hover:bg-background/60 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
                    onClick={() => close(tab.id)}
                  >
                    <XIcon aria-hidden="true" className="size-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="New chat"
          title="New chat"
          className="size-8 rounded-full text-muted-foreground"
          onClick={onNew}
        >
          <PlusIcon aria-hidden="true" className="size-4" />
        </Button>
        <ChatLibrary
          sessions={sessions}
          activeId={activeId}
          onSelect={onSelect}
        />
      </div>
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${panelId}-${value}`}
        className="min-h-0 flex-1 outline-none"
      >
        {children}
      </div>
    </div>
  )
}

function ChatLibrary({
  sessions,
  activeId,
  onSelect,
}: Pick<
  Parameters<typeof ChatSessions>[0],
  "sessions" | "activeId" | "onSelect"
>) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost" size="icon" />}
        aria-label="All chats"
        title="All chats"
        className="size-8 rounded-full text-muted-foreground"
      >
        <MenuIcon aria-hidden="true" className="size-4" />
      </DialogTrigger>
      <DialogContent data-chat-context className="max-w-2xl">
        <ChatLibraryList
          sessions={sessions}
          activeId={activeId}
          onSelect={(id) => {
            onSelect(id)
            setOpen(false)
            restoreChatFocus(true)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function ChatLibraryList({
  sessions,
  activeId,
  onSelect,
}: Pick<
  Parameters<typeof ChatSessions>[0],
  "sessions" | "activeId" | "onSelect"
>) {
  const [search, setSearch] = useState("")
  const scroll = useRef<HTMLDivElement>(null)
  const query = search.trim().toLocaleLowerCase()
  const matches = sessions.filter((session) =>
    (session.title || "Untitled chat").toLocaleLowerCase().includes(query),
  )
  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 48,
    getItemKey: (index) => matches[index].id,
    overscan: 4,
  })

  return (
    <>
      <div className="flex flex-col gap-1.5 pr-8">
        <DialogTitle className="text-lg font-semibold">All chats</DialogTitle>
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-input px-3">
        <SearchIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <input
          aria-label="Search chats"
          placeholder="Search chats…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            scroll.current?.scrollTo({ top: 0 })
          }}
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      <div
        ref={scroll}
        className="h-[min(24rem,50dvh)] overflow-y-auto"
        aria-label="Saved chats"
      >
        {matches.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {sessions.length === 0
              ? "No chats yet."
              : "No chats match your search."}
          </p>
        ) : (
          <ul
            className="relative"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const session = matches[item.index]
              return (
                <li
                  key={session.id}
                  className="absolute left-0 top-0 w-full py-1"
                  style={{
                    height: item.size,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <button
                    type="button"
                    aria-current={session.id === activeId ? "true" : undefined}
                    className={cn(
                      "flex h-full w-full items-center rounded-full px-3 text-left text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      session.id === activeId &&
                        "bg-accent font-medium text-foreground",
                    )}
                    onClick={() => onSelect(session.id)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {session.title || "Untitled chat"}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
