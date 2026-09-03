"use client"

import {
  LegendList,
  type LegendListRenderItemProps,
} from "@legendapp/list/react"
import { useCallback, useState } from "react"

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
import type { ReactNode } from "react"

type MessageListProps = {
  messages: ChatMessage[]
  header?: ReactNode
  footer?: ReactNode
  onOption: (label: string) => void
  onDecision: (proposalId: string, decision: "accept" | "reject") => void
}

function keyExtractor(item: ChatMessage) {
  return item.id
}

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
      const enableMath = message.status !== "streaming"
      const progress = message.progress ?? []
      return (
        <div className="flex justify-start py-2">
          <div className="flex max-w-[85%] flex-col gap-2 text-sm">
            {progress.length > 0 && message.status === "streaming" ? (
              <ul className="text-muted-foreground space-y-1 text-xs">
                {progress.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            ) : null}
            {message.parts.map((part, index) => (
              <PartView
                key={`${message.id}-${index}`}
                part={part}
                enableMath={enableMath}
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

function PartView({
  part,
  enableMath,
  actionsEnabled,
  onOption,
  onDecision,
}: {
  part: MessagePart
  enableMath: boolean
  actionsEnabled: boolean
  onOption: (label: string) => void
  onDecision: (proposalId: string, decision: "accept" | "reject") => void
}) {
  if (part.type === "text") {
    return <AssistantMarkdown text={part.content} enableMath={enableMath} />
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

function ComposerSpacer() {
  return <div className="h-36 shrink-0" aria-hidden />
}

function ListFooter({ footer }: { footer: ReactNode }) {
  return (
    <>
      {footer}
      <ComposerSpacer />
    </>
  )
}

export function MessageList({
  messages,
  header,
  footer,
  onOption,
  onDecision,
}: MessageListProps) {
  const [expandedImage, setExpandedImage] = useState<ChatMessageAttachment | null>(
    null
  )
  const lastMessageId = messages.at(-1)?.id

  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<ChatMessage>) => (
      <div className="mx-auto w-full max-w-3xl px-4">
        <MessageRow
          message={item}
          isLatest={isLatestChatMessage(item.id, lastMessageId)}
          onExpandImage={setExpandedImage}
          onOption={onOption}
          onDecision={onDecision}
        />
      </div>
    ),
    [lastMessageId, onDecision, onOption]
  )

  return (
    <>
      <LegendList
        className="h-full min-h-0 overflow-x-hidden overscroll-y-contain [overflow-anchor:none]"
        style={{ height: "100%" }}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={(item) => {
          const lastId = messages[messages.length - 1]?.id
          if (item.id === lastId) {
            return `${item.role}-last`
          }
          return item.role
        }}
        estimatedItemSize={72}
        initialScrollAtEnd
        maintainScrollAtEnd
        maintainVisibleContentPosition
        ListHeaderComponent={header ?? undefined}
        ListFooterComponent={<ListFooter footer={footer} />}
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
