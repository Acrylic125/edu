"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import { BookOpenIcon, PlusIcon, SettingsIcon } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  TopicNavigation,
  TopicNavigationItem,
  WorkspaceFrame,
  WorkspaceSidebar,
  useWorkspaceLayout,
} from "@edu/ui/workspace"

import { ThemeMenu } from "@/components/theme/theme-menu"
import { AccountMenu } from "@/components/ui/account-menu"
import { buttonVariants } from "@/components/ui/button"
import type { TopicCatalog } from "@/lib/chat/types"
import { cn } from "@/lib/utils"

const ChatFrameContext = createContext<{
  setCatalog: (catalog: TopicCatalog) => void
  drafts: Record<string, string>
  setDraft: (id: string, value: string) => void
} | null>(null)

export function ChatFrame({
  catalog,
  children,
}: {
  catalog: TopicCatalog
  children: ReactNode
}) {
  const [liveCatalog, setCatalog] = useState<TopicCatalog | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const topics = liveCatalog ?? catalog
  const { chatId } = useParams<{ chatId?: string }>()
  const title = topics.byId[chatId ?? ""]?.title ?? "New topic"

  return (
    <ChatFrameContext.Provider
      value={{
        setCatalog,
        drafts,
        setDraft: (id, value) => {
          setDrafts((current) => ({ ...current, [id]: value }))
        },
      }}
    >
      <WorkspaceFrame
        title={title}
        workspaceId={chatId ?? "new"}
        hasChat={!!chatId}
        sidebar={<ChatSidebar topics={topics} chatId={chatId} />}
      >
        {children}
      </WorkspaceFrame>
    </ChatFrameContext.Provider>
  )
}

function ChatSidebar({
  topics,
  chatId,
}: {
  topics: TopicCatalog
  chatId?: string
}) {
  const { closeNavigation } = useWorkspaceLayout()
  return (
    <WorkspaceSidebar
      brand={
        <Link
          href="/chat"
          onClick={closeNavigation}
          className="flex items-center gap-3 rounded-xl text-left text-xl font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className="flex size-11 items-center justify-center rounded-2xl bg-learning-yellow text-primary"
            aria-hidden="true"
          >
            <BookOpenIcon className="size-5" />
          </span>
          Prune
        </Link>
      }
      footer={
        <>
          <AccountMenu />
          <span className="mr-auto text-xs text-muted-foreground">Account</span>
          <ThemeMenu />
          <Link
            href="/settings"
            aria-label="Settings"
            className={cn(
              buttonVariants({ variant: "ghost", size: "auto" }),
              "rounded-full border-0 p-2 text-muted-foreground hover:bg-accent",
            )}
          >
            <SettingsIcon className="size-5" />
          </Link>
        </>
      }
    >
      <Link
        href="/chat"
        onClick={closeNavigation}
        className={cn(
          buttonVariants({ variant: "learning", size: "auto" }),
          "mb-7 flex h-12 w-full gap-2 rounded-full border-0 font-semibold",
        )}
      >
        <PlusIcon aria-hidden="true" className="size-4" />
        New topic
      </Link>
      <TopicNavigation empty={topics.order.length === 0}>
        {topics.order.map((topicId) => {
          const topic = topics.byId[topicId]
          if (!topic) return null
          return (
            <TopicNavigationItem
              key={topicId}
              title={topic.title}
              selected={topicId === chatId}
              render={<Link href={`/chat/${encodeURIComponent(topicId)}`} />}
              onClick={closeNavigation}
            />
          )
        })}
      </TopicNavigation>
    </WorkspaceSidebar>
  )
}

export function useChatFrame() {
  const context = useContext(ChatFrameContext)
  if (!context) throw new Error("useChatFrame must be used within ChatFrame")
  return context
}
