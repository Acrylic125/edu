import { Check, ChevronDown, ChevronRight, MessagesSquare } from "lucide-react"
import { Button } from "@edu/ui/button"
import { ContextMenuItem, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "@edu/ui/context-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@edu/ui/dropdown-menu"
import { restoreChatFocus } from "@edu/ui/chat"
import { useWorkspaceLayout } from "@edu/ui/workspace"
import type { Snapshot } from "../shared/contracts"

export function ScratchpadThreads({ topicId, chats, activeId, onSelect, submenu = false }: {
  topicId: string
  chats: Snapshot["chats"]
  activeId?: string
  onSelect: (id: string) => void
  submenu?: boolean
}) {
  const { closeNavigation, revealChat } = useWorkspaceLayout()
  const threads = chats.filter((chat) => chat.messages.some((message) => message.topicIds.includes(topicId)))
  const Item = submenu ? ContextMenuItem : DropdownMenuItem
  const items = threads.length === 0
    ? <Item disabled>No threads have referenced this scratchpad</Item>
    : threads.map((thread) => <Item key={thread.id} aria-current={thread.id === activeId ? "true" : undefined}
      onClick={() => {
        closeNavigation()
        revealChat()
        onSelect(thread.id)
        restoreChatFocus(true)
      }}>
      <span className="min-w-0 flex-1 truncate">{thread.title || "Untitled thread"}</span>
      {thread.id === activeId && <Check aria-hidden="true" />}
    </Item>)

  if (submenu) return <ContextMenuSub>
    <ContextMenuSubTrigger>
      <MessagesSquare aria-hidden="true" />
      Threads
      <ChevronRight aria-hidden="true" className="ml-auto" />
    </ContextMenuSubTrigger>
    <ContextMenuSubContent className="w-72 max-w-[calc(100vw-2rem)]" aria-label="Scratchpad threads">{items}</ContextMenuSubContent>
  </ContextMenuSub>

  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant="outline" className="rounded-full" />}>
      <MessagesSquare aria-hidden="true" />
      View Threads
      <ChevronDown aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuContent className="w-72 max-w-[calc(100vw-2rem)]" aria-label="Scratchpad threads">{items}</DropdownMenuContent>
  </DropdownMenu>
}
