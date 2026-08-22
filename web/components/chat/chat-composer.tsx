"use client"

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { ArrowUpIcon, PaperclipIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type ChatComposerProps = {
  onSend: (content: string) => void
  className?: string
}

export function ChatComposer({ onSend, className }: ChatComposerProps) {
  const [draft, setDraft] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canSend = draft.trim() !== ""

  function submit() {
    if (!canSend) {
      return
    }
    onSend(draft)
    setDraft("")
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    submit()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "flex min-h-28 w-full flex-col rounded-2xl border border-border/80 bg-input shadow-lg backdrop-blur-md",
        className
      )}
    >
      <Textarea
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        onKeyDown={handleKeyDown}
        placeholder="Ask or answer questions"
        rows={1}
        className="min-h-16 max-h-40 flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent px-4 pt-3 pb-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />

      <div className="flex items-center justify-between gap-2 px-3 pb-3">
        <div className="flex items-center">
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            tabIndex={-1}
            onChange={() => {
              // UI-only for now; no upload pipeline yet.
              if (fileInputRef.current) {
                fileInputRef.current.value = ""
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Upload"
            onClick={() => {
              fileInputRef.current?.click()
            }}
          >
            <PaperclipIcon />
          </Button>
        </div>

        <Button
          type="submit"
          size="icon-sm"
          disabled={!canSend}
          aria-label="Send"
          className="rounded-full"
        >
          <ArrowUpIcon />
        </Button>
      </div>
    </form>
  )
}
