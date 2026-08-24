"use client"

import { ChevronsUpDownIcon } from "lucide-react"

import { useSwitchTopic } from "@/components/chat/use-switch-topic"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useChatStore } from "@/lib/chat/store"

export function TopicMenu() {
  const catalog = useChatStore((state) => state.catalog)
  const session = useChatStore((state) => state.session)
  const switchTopic = useSwitchTopic()

  if (catalog.order.length === 0 && session.kind === "none") {
    return null
  }

  let currentId: string | null = null
  let currentTitle = "Topics"
  if (session.kind === "topic") {
    currentId = session.topicId === "" ? null : session.topicId
    if (session.title) {
      currentTitle = session.title
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="max-w-48 gap-1 px-2 text-xs font-normal"
          />
        }
      >
        <span className="truncate">{currentTitle}</span>
        <ChevronsUpDownIcon className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48 max-w-72">
        {catalog.order.map((topicId) => {
          const listing = catalog.byId[topicId]
          if (!listing) {
            return null
          }
          const selected = topicId === currentId
          return (
            <DropdownMenuItem
              key={topicId}
              disabled={selected}
              className="cursor-pointer"
              onClick={() => {
                void switchTopic(topicId)
              }}
            >
              <span className="truncate">{listing.title}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
