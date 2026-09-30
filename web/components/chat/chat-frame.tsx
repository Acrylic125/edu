"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import { MenuIcon, MessageSquareIcon, SettingsIcon, XIcon } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"

import { AccountMenu } from "@/components/ui/account-menu"
import type { TopicCatalog } from "@/lib/chat/types"
import { cn } from "@/lib/utils"

const ChatFrameContext = createContext<{
  chatOpen: boolean
  setChatOpen: (open: boolean) => void
  setCatalog: (catalog: TopicCatalog) => void
} | null>(null)

export function ChatFrame({ catalog, children }: { catalog: TopicCatalog; children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [liveCatalog, setCatalog] = useState<TopicCatalog | null>(null)
  const topics = liveCatalog ?? catalog
  const { chatId } = useParams<{ chatId?: string }>()
  const title = topics.byId[chatId ?? ""]?.title ?? "New topic"

  function closeNavigation() {
    setSidebarOpen(false)
    setChatOpen(false)
  }

  return (
    <ChatFrameContext.Provider value={{ chatOpen, setChatOpen, setCatalog }}>
      <div className="flex h-dvh min-h-0 overflow-hidden bg-background text-foreground">
        {sidebarOpen ? <button type="button" aria-label="Close topics" className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setSidebarOpen(false)} /> : null}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 flex w-[min(19rem,85vw)] shrink-0 flex-col border-r border-border bg-sidebar transition-transform duration-200 motion-reduce:transition-none md:static md:w-64 md:translate-x-0 lg:w-72",
            sidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
          aria-label="Topics"
        >
          <div className="flex h-20 shrink-0 items-center justify-between px-5">
            <Link href="/chat" onClick={closeNavigation} className="flex items-center gap-3 rounded-md text-left text-lg font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="flex size-8 items-center justify-center rounded-lg border border-primary/35 bg-primary/10 font-serif text-xl text-primary" aria-hidden="true">P</span>
              Prune
            </Link>
            <button type="button" aria-label="Close topics" className="rounded-md p-2 text-muted-foreground md:hidden" onClick={() => setSidebarOpen(false)}><XIcon className="size-5" /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5">
            <Link href="/chat" onClick={closeNavigation} className="mb-5 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span aria-hidden="true" className="text-lg leading-none">+</span>
              New topic
            </Link>
            <p className="px-3 pb-2 text-xs font-medium text-muted-foreground">Your topics</p>
            <nav className="space-y-1" aria-label="Your topics">
              {topics.order.map((topicId) => {
                const topic = topics.byId[topicId]
                if (!topic) return null
                const selected = topicId === chatId
                return (
                  <Link
                    key={topicId}
                    href={`/chat/${encodeURIComponent(topicId)}`}
                    aria-current={selected ? "page" : undefined}
                    className={cn(
                      "flex min-h-10 w-full items-center rounded-lg px-3 py-2 text-left text-sm leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected ? "bg-sidebar-accent font-medium text-sidebar-foreground ring-1 ring-sidebar-border" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                    )}
                    onClick={closeNavigation}
                  >
                    <span className="line-clamp-2">{topic.title}</span>
                  </Link>
                )
              })}
            </nav>
          </div>
          <div className="flex h-16 shrink-0 items-center gap-3 border-t border-border px-4">
            <AccountMenu />
            <Link href="/settings" aria-label="Settings" className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><SettingsIcon className="size-5" /></Link>
          </div>
        </aside>
        <div className="relative flex min-w-0 flex-1 flex-col">
          <header className={cn("flex h-14 shrink-0 items-center gap-3 border-b border-border px-4", chatId ? "lg:hidden" : "md:hidden")}>
            <button type="button" aria-label="Open topics" className="rounded-md p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden" onClick={() => setSidebarOpen(true)}><MenuIcon className="size-5" /></button>
            <span className="truncate text-sm font-medium">{title}</span>
            {chatId ? <button type="button" aria-label="Open chat" className="ml-auto rounded-md p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setChatOpen(true)}><MessageSquareIcon className="size-5" /></button> : null}
          </header>
          <div className="flex min-h-0 flex-1">{children}</div>
        </div>
      </div>
    </ChatFrameContext.Provider>
  )
}

export function useChatFrame() {
  const context = useContext(ChatFrameContext)
  if (!context) throw new Error("useChatFrame must be used within ChatFrame")
  return context
}

export function ChatWorkspacePanes({ body, chat, status }: { body: ReactNode; chat: ReactNode; status: ReactNode }) {
  const { chatOpen, setChatOpen } = useChatFrame()
  return (
    <>
      <main data-document-pane className="relative min-h-0 min-w-0 flex-1 overflow-hidden">{body}</main>
      {chat ? <>
        {chatOpen ? <button type="button" aria-label="Close chat" className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setChatOpen(false)} /> : null}
        <aside aria-label="Chat" className={cn("fixed inset-y-0 right-0 z-40 flex w-[min(26rem,100vw)] flex-col border-l border-border bg-background transition-transform duration-200 motion-reduce:transition-none lg:static lg:w-[22rem] lg:shrink-0 lg:translate-x-0 xl:w-[25rem]", chatOpen ? "translate-x-0" : "translate-x-full")}>
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
            <h2 className="text-sm font-semibold">Chat</h2>
            <span className="ml-auto text-xs text-muted-foreground">{status}</span>
            <button type="button" aria-label="Close chat" className="rounded-md p-2 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden" onClick={() => setChatOpen(false)}><XIcon className="size-5" /></button>
          </div>
          <div className="min-h-0 flex-1">{chat}</div>
        </aside>
      </> : null}
    </>
  )
}
