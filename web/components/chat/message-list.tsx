"use client"

import {
  LegendList,
  type LegendListRef,
  type LegendListRenderItemProps,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "@legendapp/list/react"
import { useCallback, useLayoutEffect, useRef, useState } from "react"

import { AssistantMarkdown } from "@/components/chat/assistant-markdown"
import {
  ImagePreviewDialog,
  MessageImageGrid,
} from "@/components/chat/composer-attachments"
import { SkillInlineText } from "@/components/chat/skill-inline-text"
import { Button } from "@/components/ui/button"
import { isLatestChatMessage } from "@/lib/chat/latest-message"
import { shortOptionLabel } from "@/lib/chat/option-label"
import { MOCK_SKILLS } from "@/lib/chat/skills"
import type { ChatMessage, ChatMessageAttachment } from "@/lib/chat/types"
import type { MessagePart } from "@/lib/chat/ws-schema"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

type MessageListProps = {
  messages: ChatMessage[]
  header?: ReactNode
  footer?: ReactNode
  onOption: (label: string) => void
  onDecision: (proposalId: string, decision: "accept" | "reject") => void
}

// LegendList snapshots this prop by identity, so it must stay stable across renders.
const messageListContentStyle = { paddingBottom: 144 } as const

function textFromParts(parts: MessagePart[]) {
  const lines: string[] = []
  for (const part of parts) {
    if (part.type === "text") {
      lines.push(part.content)
    }
  }
  return lines.join("\n")
}

function MessageRow({
  message,
  isLatest,
  onExpandImage,
  onOption,
  onDecision,
}: {
  message: ChatMessage
  isLatest: boolean
  onExpandImage: (image: ChatMessageAttachment) => void
  onOption: (label: string) => void
  onDecision: (proposalId: string, decision: "accept" | "reject") => void
}) {
  const attachments = message.attachments ?? []

  switch (message.role) {
    case "user": {
      const text = textFromParts(message.parts)
      return (
        <div className="flex justify-end py-2">
          <div className="w-fit max-w-[85%] rounded-2xl bg-secondary px-3 py-2 text-sm">
            <MessageImageGrid images={attachments} onExpand={onExpandImage} />
            {text.length > 0 ? (
              <p className="whitespace-pre-wrap">
                <SkillInlineText text={text} skills={MOCK_SKILLS} />
              </p>
            ) : null}
            {text.length === 0 && attachments.length > 0 ? (
              <p className="text-muted-foreground text-xs italic">Attached image</p>
            ) : null}
          </div>
        </div>
      )
    }
    case "assistant": {
      const enableRichContent =
        message.status !== "streaming" && message.status !== "cancelled"
      const progress = message.progress ?? []
      const hasMermaid = message.parts.some(
        (part) =>
          part.type === "text" && /```mermaid(?:\s|$)/i.test(part.content)
      )
      return (
        <div className="flex justify-start py-2">
          <div
            className={cn(
              "flex flex-col gap-2 text-sm",
              hasMermaid ? "w-full" : "max-w-[85%]"
            )}
          >
            {progress.length > 0 && message.status === "streaming" ? (
              <ThinkingStatus steps={progress} />
            ) : null}
            {message.parts.map((part, index) => (
              <PartView
                key={`${message.id}-${index}`}
                part={part}
                renderScope={`${message.id}-${index}`}
                enableRichContent={enableRichContent}
                actionsEnabled={isLatest}
                onOption={onOption}
                onDecision={onDecision}
              />
            ))}
          </div>
        </div>
      )
    }
    default: {
      const _exhaustive: never = message.role
      return _exhaustive
    }
  }
}

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
      <span className="flex w-5 shrink-0 items-center justify-center gap-0.5" aria-hidden>
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

function PartView({
  part,
  renderScope,
  enableRichContent,
  actionsEnabled,
  onOption,
  onDecision,
}: {
  part: MessagePart
  renderScope: string
  enableRichContent: boolean
  actionsEnabled: boolean
  onOption: (label: string) => void
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
  if (part.type === "options") {
    if (!actionsEnabled) {
      return null
    }
    const options: Array<{ key: string; label: string }> = []
    for (const option of part.options) {
      const label = shortOptionLabel(option.label)
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
              className="max-w-full"
              onClick={() => {
                onOption(option.label)
              }}
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

export function MessageList({
  messages,
  header,
  footer,
  onOption,
  onDecision,
}: MessageListProps) {
  const listRef = useRef<LegendListRef>(null)
  const followStreamingRef = useRef(true)
  const lastScrollOffsetRef = useRef(0)
  const previousMessageIdRef = useRef<string | undefined>(undefined)
  const [expandedImage, setExpandedImage] = useState<ChatMessageAttachment | null>(
    null
  )
  const lastMessage = messages.at(-1)
  const lastMessageId = lastMessage?.id

  useLayoutEffect(() => {
    if (previousMessageIdRef.current !== lastMessageId) {
      previousMessageIdRef.current = lastMessageId
      followStreamingRef.current = true
      lastScrollOffsetRef.current = 0
    }

    if (!followStreamingRef.current) {
      return
    }

    const timer = window.setTimeout(() => {
      void listRef.current?.scrollToEnd({ animated: false })
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [lastMessage, lastMessageId, messages])

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
      const distanceFromEnd =
        contentSize.height - layoutMeasurement.height - contentOffset.y
      const scrollingUp = contentOffset.y < lastScrollOffsetRef.current - 1

      if (scrollingUp) {
        followStreamingRef.current = false
      } else if (distanceFromEnd < 160) {
        followStreamingRef.current = true
      }

      lastScrollOffsetRef.current = contentOffset.y
    },
    []
  )

  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<ChatMessage>) => {
      const isLatest = isLatestChatMessage(item.id, lastMessageId)
      return (
        <>
          <div className="mx-auto w-full max-w-3xl px-4">
            <MessageRow
              message={item}
              isLatest={isLatest}
              onExpandImage={setExpandedImage}
              onOption={onOption}
              onDecision={onDecision}
            />
          </div>
          {isLatest ? footer : null}
        </>
      )
    },
    [footer, lastMessageId, onDecision, onOption]
  )

  return (
    <>
      <LegendList
        ref={listRef}
        className="h-full min-h-0 overflow-x-hidden overscroll-y-contain [overflow-anchor:none]"
        style={{ height: "100%" }}
        contentContainerStyle={messageListContentStyle}
        data={messages}
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
        onScroll={handleScroll}
        recycleItems={false}
        ListHeaderComponent={
          header == null ? undefined : <ListHeader header={header} />
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
