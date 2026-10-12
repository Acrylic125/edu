"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import { MenuIcon, MessageSquareIcon, XIcon } from "lucide-react"

import { Button } from "../primitives/button"
import { cn } from "../utils"

export { TopicNavigation, TopicNavigationItem } from "./topic-navigation"

const WorkspaceLayoutContext = createContext<{
  sidebarOpen: boolean
  chatOpen: boolean
  closeNavigation: () => void
  setSidebarOpen: (open: boolean) => void
  setChatOpen: (open: boolean) => void
} | null>(null)

export function useWorkspaceLayout() {
  const context = useContext(WorkspaceLayoutContext)
  if (!context)
    throw new Error("Workspace layouts must be used within WorkspaceFrame")
  return context
}

export function WorkspaceFrame({
  title,
  hasChat = false,
  sidebar,
  banner,
  children,
}: {
  title: string
  hasChat?: boolean
  sidebar: ReactNode
  banner?: ReactNode
  children: ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)

  function closeNavigation() {
    setSidebarOpen(false)
    setChatOpen(false)
  }

  return (
    <WorkspaceLayoutContext.Provider
      value={{
        sidebarOpen,
        chatOpen,
        closeNavigation,
        setSidebarOpen,
        setChatOpen,
      }}
    >
      <div className="flex h-dvh min-h-0 gap-3 overflow-hidden bg-background text-foreground md:p-3 lg:gap-4 lg:p-4">
        {sidebar}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <header
            className={cn(
              "flex h-16 shrink-0 items-center gap-3 px-4",
              hasChat ? "lg:hidden" : "md:hidden",
            )}
          >
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open topics"
              aria-expanded={sidebarOpen}
              aria-controls="topics-sidebar"
              className="size-9 rounded-full p-2 md:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <MenuIcon className="size-5" />
            </Button>
            <span className="truncate text-sm font-medium">{title}</span>
            {hasChat ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open chat"
                aria-expanded={chatOpen}
                aria-controls="learning-chat"
                className="ml-auto size-9 rounded-full p-2"
                onClick={() => setChatOpen(true)}
              >
                <MessageSquareIcon className="size-5" />
              </Button>
            ) : null}
          </header>
          {banner}
          <div className="flex min-h-0 flex-1 gap-3 lg:gap-4">{children}</div>
        </div>
      </div>
    </WorkspaceLayoutContext.Provider>
  )
}

export function WorkspaceSidebar({
  brand,
  children,
  actions,
  footer,
  label = "Topics",
}: {
  brand: ReactNode
  children: ReactNode
  actions?: ReactNode
  footer: ReactNode
  label?: string
}) {
  const { sidebarOpen, setSidebarOpen } = useWorkspaceLayout()
  return (
    <>
      {sidebarOpen ? (
        <Button
          variant="plain"
          size="auto"
          aria-label="Close topics"
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <aside
        id="topics-sidebar"
        aria-label={label}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[min(19rem,85vw)] shrink-0 flex-col bg-sidebar transition-transform duration-200 motion-reduce:transition-none md:static md:w-56 md:translate-x-0 md:rounded-[1.75rem] lg:w-60",
          sidebarOpen
            ? "visible translate-x-0"
            : "invisible -translate-x-full md:visible",
        )}
      >
        <div className="flex h-24 shrink-0 items-center justify-between px-5">
          {brand}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close topics"
            className="size-9 rounded-full p-2 text-muted-foreground md:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <XIcon className="size-5" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5">
          {children}
        </div>
        {actions ? <div className="px-3 pb-3">{actions}</div> : null}
        <div className="mx-3 flex h-20 shrink-0 items-center gap-2 border-t border-sidebar-border px-1">
          {footer}
        </div>
      </aside>
    </>
  )
}

export function WorkspacePanes({
  body,
  chat,
  status,
  documentActions,
  chatLabel = "Chat",
}: {
  body: ReactNode
  chat?: ReactNode
  status?: ReactNode
  documentActions?: ReactNode
  chatLabel?: string
}) {
  const { chatOpen, setChatOpen } = useWorkspaceLayout()
  return (
    <>
      <main
        data-document-pane
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden md:rounded-[1.75rem] data-[has-chat=true]:bg-card"
        data-has-chat={chat ? "true" : undefined}
      >
        {documentActions}
        {body}
      </main>
      {chat ? (
        <>
          {chatOpen ? (
            <Button
              variant="plain"
              size="auto"
              aria-label="Close chat"
              className="fixed inset-0 z-30 bg-black/60 lg:hidden"
              onClick={() => setChatOpen(false)}
            />
          ) : null}
          <aside
            id="learning-chat"
            aria-label={chatLabel}
            className={cn(
              "fixed inset-y-0 right-0 z-40 flex w-[min(26rem,100vw)] flex-col bg-sidebar transition-transform duration-200 motion-reduce:transition-none lg:static lg:w-[22rem] lg:shrink-0 lg:translate-x-0 lg:rounded-[1.75rem] xl:w-[25rem]",
              chatOpen
                ? "visible translate-x-0"
                : "invisible translate-x-full lg:visible",
            )}
          >
            <div className="flex h-18 shrink-0 items-center gap-3 border-b border-sidebar-border px-5">
              <h2 className="text-sm font-semibold">Chat</h2>
              <span className="ml-auto text-xs text-muted-foreground">
                {status}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close chat"
                className="size-9 rounded-full p-2 text-muted-foreground lg:hidden"
                onClick={() => setChatOpen(false)}
              >
                <XIcon className="size-5" />
              </Button>
            </div>
            <div className="min-h-0 flex-1">{chat}</div>
          </aside>
        </>
      ) : null}
    </>
  )
}
