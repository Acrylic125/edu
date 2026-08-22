"use client"

import Link from "next/link"
import { Settings } from "lucide-react"

import { ChatComposer } from "@/components/chat/chat-composer"
import { MessageList } from "@/components/chat/message-list"
import { Button } from "@/components/ui/button"
import type { Chat, ChatMessageAttachment } from "@/lib/chat/types"
import { cn } from "@/lib/utils"

type ChatMainProps = {
  chat: Chat | null
  onSend: (content: string, attachments: ChatMessageAttachment[]) => void
}

export function ChatMain({ chat, onSend }: ChatMainProps) {
  const isEmptyChat = chat !== null && chat.messages.length === 0
  const hasMessages = chat !== null && chat.messages.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {chat === null ? "Chat" : chat.title}
        </h1>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Settings"
          nativeButton={false}
          render={<Link href="/settings" />}
        >
          <Settings />
        </Button>
      </header>

      {chat === null ? (
        <div className="flex flex-1 items-center justify-center px-4">
          <p className="text-sm text-muted-foreground">No chat selected</p>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            className={cn(
              "absolute inset-0 min-h-0 overflow-hidden transition-opacity duration-500 ease-out",
              hasMessages ? "opacity-100" : "pointer-events-none opacity-0"
            )}
            aria-hidden={!hasMessages}
          >
            <MessageList messages={chat.messages} />
          </div>

          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center px-4 transition-[bottom,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
              isEmptyChat
                ? "bottom-1/2 translate-y-1/2"
                : "bottom-4 translate-y-0"
            )}
          >
            <div
              className={cn(
                "overflow-hidden text-center transition-all duration-300 ease-out",
                isEmptyChat
                  ? "mb-8 max-h-24 translate-y-0 opacity-100"
                  : "mb-0 max-h-0 -translate-y-2 opacity-0"
              )}
            >
              <p className="text-xl font-medium tracking-tight">New chat</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Send a message to get started.
              </p>
            </div>

            <div className="pointer-events-auto w-full max-w-3xl">
              <ChatComposer key={chat.id} onSend={onSend} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
