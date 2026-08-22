"use client"

import Link from "next/link"
import { Settings, SquarePen } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import type { Chat, ChatId } from "@/lib/chat/types"

type ChatSidebarProps = {
  chats: Chat[]
  activeChatId: ChatId | null
  onSelect: (chatId: ChatId) => void
  onNewChat: () => void
}

export function ChatSidebar({
  chats,
  activeChatId,
  onSelect,
  onNewChat,
}: ChatSidebarProps) {
  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="gap-2 border-b border-sidebar-border p-2">
        <div className="flex items-center justify-between gap-2 px-1 py-1">
          <span className="text-sm font-medium text-sidebar-foreground">
            Chats
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onNewChat}
            aria-label="New chat"
          >
            <SquarePen />
          </Button>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>History</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {chats.map((chat) => (
                <SidebarMenuItem key={chat.id}>
                  <SidebarMenuButton
                    type="button"
                    isActive={chat.id === activeChatId}
                    onClick={() => {
                      onSelect(chat.id)
                    }}
                  >
                    <span>{chat.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/settings" />}>
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
