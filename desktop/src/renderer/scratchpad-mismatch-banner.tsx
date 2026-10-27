import { ChevronDown } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@edu/ui/dropdown-menu"
import type { Snapshot } from "../shared/contracts"

export function ScratchpadMismatchBanner({ topics, messages, currentId, onSwitch }: {
  topics: Snapshot["topics"]
  messages: Snapshot["chats"][number]["messages"]
  currentId?: string
  onSwitch: (id: string) => void
}) {
  // Assistant messages are persisted only after a verified turn commits.
  if (!messages.some((message) => message.role === "assistant")) return null
  if (topics.length === 0 || topics.some((topic) => topic.id === currentId)) return null

  const first = topics[0]
  let action
  if (topics.length === 1) {
    action = (
      <>
        <span className="shrink-0">switch to</span>
        <button
          type="button"
          title={first.title}
          className="min-w-0 truncate rounded-sm font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={() => onSwitch(first.id)}
        >
          {first.title}
        </button>
        <span>?</span>
      </>
    )
  } else {
    action = (
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex shrink-0 items-center gap-1 rounded-sm font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Switch
          <ChevronDown aria-hidden="true" className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64 max-w-[calc(100vw-2rem)]" aria-label="Referenced scratchpads">
          {topics.map((topic) => (
            <DropdownMenuItem key={topic.id} title={topic.title} onClick={() => onSwitch(topic.id)}>
              <span className="truncate">{topic.title}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div role="note" aria-label="Different scratchpad" className="flex min-w-0 shrink-0 items-center gap-1 border-b border-learning-ink/10 bg-learning-yellow px-4 py-2 text-xs text-learning-ink">
      <span className="shrink-0">Different scratchpad,</span>
      {action}
    </div>
  )
}
