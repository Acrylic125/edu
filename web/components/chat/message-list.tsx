"use client"

import {
  LegendList,
  type LegendListRenderItemProps,
} from "@legendapp/list/react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { memo, useCallback, useState } from "react"

import { AssistantMarkdown } from "@/components/chat/assistant-markdown"
import {
  ImagePreviewDialog,
  MessageImageGrid,
} from "@/components/chat/composer-attachments"
import { SkillInlineText } from "@/components/chat/skill-inline-text"
import { Button } from "@/components/ui/button"
import { isLatestChatMessage } from "@/lib/chat/latest-message"
import { shortFocus, shortOptionLabel } from "@/lib/chat/option-label"
import { CHAT_COMMANDS } from "@/lib/chat/skills"
import type { ChatMessage, ChatMessageAttachment } from "@/lib/chat/types"
import type { MessagePart } from "@/lib/chat/ws-schema"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

type MessageListProps = {
  messages: ChatMessage[]
  header?: ReactNode
  footer?: ReactNode
  optionState: { messageId: string; status: "pending" | "failed" } | null
  currentStepId: string | null
  onOption: (messageId: string, label: string) => void
  onDecision: (proposalId: string, decision: "accept" | "reject") => void
}

// LegendList snapshots this prop by identity, so it must stay stable across renders.
const messageListContentStyle = { paddingBottom: 240 } as const

function textFromParts(parts: MessagePart[]) {
  const lines: string[] = []
  for (const part of parts) {
    if (part.type === "text") {
      lines.push(part.content)
    }
  }
  return lines.join("\n")
}

function planFromMessages(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const plan = message?.parts.find((part) => part.type === "plan")
    if (plan?.type === "plan") {
      return plan.steps
    }
  }
  return null
}

function visibleOptionLabel(
  label: string,
  plan: Extract<MessagePart, { type: "plan" }>['steps'] | null,
  currentStepId: string | null,
) {
  const visible = shortOptionLabel(label)
  if (!plan) {
    return visible
  }
  const match = /^(Explain|Practice|What's) (Continue after )?(\d+)\??$/i.exec(visible)
  if (!match) {
    return visible
  }
  let step = null
  if (match[2] && currentStepId) {
    step = plan.find((item) => item.id === currentStepId) ?? null
  }
  if (!step) {
    step = plan[Number(match[3]) - 1] ?? null
  }
  if (!step) {
    return visible
  }
  const focus = shortFocus(step.label)
  if (match[1].toLowerCase() === "what's") {
    return `What's ${focus}?`
  }
  return `${match[1]} ${focus}`
}

function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  if (text.trim() === "") {
    return null
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={copied ? "Copied" : "Copy message"}
      className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          window.setTimeout(() => {
            setCopied(false)
          }, 1500)
        })
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

const MessageRow = memo(function MessageRow({
  message,
  isLatest,
  onExpandImage,
  onOption,
  onDecision,
  optionState,
  plan,
  currentStepId,
}: {
  message: ChatMessage
  isLatest: boolean
  onExpandImage: (image: ChatMessageAttachment) => void
  optionState: { messageId: string; status: "pending" | "failed" } | null
  plan: Extract<MessagePart, { type: "plan" }>['steps'] | null
  currentStepId: string | null
  onOption: (messageId: string, label: string) => void
  onDecision: (proposalId: string, decision: "accept" | "reject") => void
}) {
  const attachments: ChatMessageAttachment[] = []
  for (const part of message.parts) {
    if (part.type === "attachment" && part.url)
      attachments.push({
        id: part.ref,
        name: part.filename ?? "Image",
        mimeType: part.mimeType ?? "image/jpeg",
        previewUrl: part.url,
      })
  }

  switch (message.role) {
    case "user": {
      const text = textFromParts(message.parts)
      return (
        <div className="group flex flex-col items-end py-2">
          <div className="w-fit max-w-[85%] rounded-2xl bg-secondary px-3 py-2 text-sm">
            <MessageImageGrid images={attachments} onExpand={onExpandImage} />
            {text.length > 0 ? (
              <p className="whitespace-pre-wrap">
                <SkillInlineText text={text} skills={CHAT_COMMANDS} />
              </p>
            ) : null}
            {text.length === 0 && attachments.length > 0 ? (
              <p className="text-muted-foreground text-xs italic">
                Attached image
              </p>
            ) : null}
          </div>
          <CopyMessageButton text={text} />
        </div>
      )
    }
    case "assistant": {
      const enableRichContent =
        message.status !== "streaming" && message.status !== "cancelled"
      const progress = message.progress ?? []
      const hasPlan = message.parts.some((part) => part.type === "plan")
      const hasMermaid = message.parts.some(
        (part) =>
          part.type === "text" && /```mermaid(?:\s|$)/i.test(part.content),
      )
      return (
        <div className="group flex flex-col items-end py-2">
          <div
            className={cn(
              "self-start",
              "flex flex-col gap-2 text-sm",
              hasMermaid ? "w-full" : "max-w-[85%]",
            )}
          >
            {progress.length > 0 && message.status === "streaming" ? (
              <ThinkingStatus steps={progress} />
            ) : null}
            {message.status === "failed" ? (
              <p className="text-destructive text-xs">
                This response could not be completed. Please retry.
              </p>
            ) : null}
            {message.status === "cancelled" ? (
              <p className="text-muted-foreground text-xs">Response stopped.</p>
            ) : null}
            {message.parts.map((part, index) => {
              if (hasPlan && part.type === "text" && /^(Here's the plan|I'll use the plan you provided:)/.test(part.content)) {
                return null
              }
              return (
                <PartView
                  key={`${message.id}-${index}`}
                  part={part}
                  messageId={message.id}
                  plan={plan}
                  currentStepId={currentStepId}
                  renderScope={`${message.id}-${index}`}
                  enableRichContent={enableRichContent}
                  actionsEnabled={isLatest || optionState?.messageId === message.id}
                  optionsDisabled={optionState?.messageId === message.id && optionState.status === "pending"}
                  onOption={onOption}
                  onDecision={onDecision}
                />
              )
            })}
          </div>
          <CopyMessageButton text={textFromParts(message.parts)} />
        </div>
      )
    }
    default: {
      const _exhaustive: never = message.role
      return _exhaustive
    }
  }
})

function ThinkingStatus({ steps }: { steps: string[] }) {
  const currentStep = steps.at(-1)

  if (currentStep == null) {
    return null
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-5 items-center gap-2 text-xs text-muted-foreground"
    >
      <span
        className="flex w-5 shrink-0 items-center justify-center gap-0.5"
        aria-hidden
      >
        <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-300ms]" />
        <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-150ms]" />
        <span className="size-1 animate-bounce rounded-full bg-current" />
      </span>
      <span
        key={`${steps.length}-${currentStep}`}
        className="min-w-0 flex-1 truncate animate-in fade-in slide-in-from-bottom-1 duration-200"
      >
        {currentStep}
      </span>
    </div>
  )
}

function planStepDepths(steps: Extract<MessagePart, { type: "plan" }>["steps"]) {
  const byId = new Map(steps.map((step) => [step.id, step]))
  const depths = new Map<string, number>()
  function depth(id: string, seen = new Set<string>()): number {
    const cached = depths.get(id)
    if (cached !== undefined) return cached
    const step = byId.get(id)
    if (!step || step.parent === null || seen.has(id)) return 0
    seen.add(id)
    const value = depth(step.parent, seen) + 1
    depths.set(id, value)
    return value
  }
  for (const step of steps) depth(step.id)
  return depths
}

function PartView({
  part,
  messageId,
  plan,
  currentStepId,
  renderScope,
  enableRichContent,
  actionsEnabled,
  optionsDisabled,
  onOption,
  onDecision,
}: {
  part: MessagePart
  messageId: string
  plan: Extract<MessagePart, { type: "plan" }>['steps'] | null
  currentStepId: string | null
  renderScope: string
  enableRichContent: boolean
  actionsEnabled: boolean
  optionsDisabled: boolean
  onOption: (messageId: string, label: string) => void
  onDecision: (proposalId: string, decision: "accept" | "reject") => void
}) {
  if (part.type === "text") {
    return (
      <AssistantMarkdown
        text={part.content}
        renderScope={renderScope}
        enableRichContent={enableRichContent}
      />
    )
  }
  if (part.type === "attachment") {
    return <p className="text-muted-foreground text-xs">{part.ref}</p>
  }
  if (part.type === "plan") {
    const depths = planStepDepths(part.steps)
    return (
      <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
        <ol className="space-y-2">
          {part.steps.map((step) => (
            <li key={step.id} style={{ marginLeft: `${(depths.get(step.id) ?? 0) * 1.25}rem` }}>
              <p className="font-medium">{step.label}</p>
              <p className="text-muted-foreground text-xs">{step.summary}</p>
            </li>
          ))}
        </ol>
      </div>
    )
  }
  if (part.type === "options") {
    if (!actionsEnabled) {
      return null
    }
    const options: Array<{ key: string; label: string }> = []
    for (const option of part.options) {
      const label = visibleOptionLabel(option.label, plan, currentStepId)
      if (/hint/i.test(label)) {
        continue
      }
      options.push({ key: option.label, label })
    }
    return (
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option.key}
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "max-w-full",
              optionsDisabled &&
                "cursor-not-allowed border-border/60 bg-muted text-muted-foreground opacity-60",
            )}
            onClick={() => {
              onOption(messageId, option.key)
            }}
            disabled={optionsDisabled}
          >
            {option.label}
          </Button>
        ))}
      </div>
    )
  }
  if (!actionsEnabled) {
    return null
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        onClick={() => {
          onDecision(part.proposalId, "accept")
        }}
      >
        Accept
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          onDecision(part.proposalId, "reject")
        }}
      >
        Reject
      </Button>
    </div>
  )
}

function ListHeader({ header }: { header: ReactNode }) {
  return <>{header}</>
}

function ListFooter({ footer }: { footer: ReactNode }) {
  return <>{footer}</>
}

export function MessageList({
  messages,
  header,
  footer,
  optionState,
  currentStepId,
  onOption,
  onDecision,
}: MessageListProps) {
  const [expandedImage, setExpandedImage] =
    useState<ChatMessageAttachment | null>(null)
  const lastMessageId = messages.at(-1)?.id
  const plan = planFromMessages(messages)
  const listRenderVersion = [
    lastMessageId,
    optionState?.messageId,
    optionState?.status,
    currentStepId,
  ].join(":")

  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<ChatMessage>) => {
      const isLatest = isLatestChatMessage(item.id, lastMessageId)
      return (
        <div className="mx-auto w-full max-w-3xl px-4">
          <MessageRow
            message={item}
            isLatest={isLatest}
            optionState={optionState}
            plan={plan}
            currentStepId={currentStepId}
            onExpandImage={setExpandedImage}
            onOption={onOption}
            onDecision={onDecision}
          />
        </div>
      )
    },
    [lastMessageId, onDecision, onOption, optionState, plan, currentStepId],
  )

  return (
    <>
      <LegendList
        className="h-full min-h-0 overflow-x-hidden overscroll-y-contain [overflow-anchor:none]"
        style={{ height: "100%" }}
        contentContainerStyle={messageListContentStyle}
        data={messages}
        extraData={listRenderVersion}
        renderItem={renderItem}
        keyExtractor={(message) => message.id}
        getItemType={(item) => {
          const lastId = messages[messages.length - 1]?.id
          if (item.id === lastId) {
            return `${item.role}-last`
          }
          return item.role
        }}
        estimatedItemSize={72}
        initialScrollAtEnd
        alignItemsAtEnd={messages.length > 0}
        maintainScrollAtEnd
        maintainScrollAtEndThreshold={0.25}
        maintainVisibleContentPosition
        recycleItems={false}
        ListHeaderComponent={
          header == null ? undefined : <ListHeader header={header} />
        }
        ListFooterComponent={
          messages.length === 0 || footer == null ? undefined : (
            <ListFooter footer={footer} />
          )
        }
        ListEmptyComponent={
          messages.length === 0 && footer != null ? <>{footer}</> : undefined
        }
      />
      <ImagePreviewDialog
        open={expandedImage !== null}
        onOpenChange={(open) => {
          if (!open) {
            setExpandedImage(null)
          }
        }}
        image={
          expandedImage
            ? { name: expandedImage.name, previewUrl: expandedImage.previewUrl }
            : null
        }
      />
    </>
  )
}
