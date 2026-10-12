"use client"

import type { ReactNode } from "react"
import { Tabs } from "@base-ui/react/tabs"
import { PlusIcon } from "lucide-react"

import { Button } from "../primitives/button"

export function ChatSessions({
  sessions,
  activeId,
  onSelect,
  onNew,
  children,
}: {
  sessions: { id: string; title: string }[]
  activeId?: string
  onSelect: (id: string) => void
  onNew: () => void
  children: ReactNode
}) {
  const value = activeId ?? "new"

  return (
    <Tabs.Root
      value={value}
      onValueChange={(id) => {
        if (id === "new") onNew()
        else if (typeof id === "string") onSelect(id)
      }}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-sidebar-border px-3">
        <Tabs.List
          aria-label="Chat sessions"
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {sessions.map((session) => (
            <Tabs.Tab
              key={session.id}
              value={session.id}
              title={session.title}
              className="max-w-36 shrink-0 truncate rounded-lg px-3 py-2 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[active]:bg-accent data-[active]:font-medium data-[active]:text-foreground"
            >
              {session.title || "Untitled chat"}
            </Tabs.Tab>
          ))}
          {!activeId && (
            <Tabs.Tab
              value="new"
              className="shrink-0 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              New chat
            </Tabs.Tab>
          )}
        </Tabs.List>
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
      </div>
      <Tabs.Panel value={value} className="min-h-0 flex-1 outline-none">
        {children}
      </Tabs.Panel>
    </Tabs.Root>
  )
}
