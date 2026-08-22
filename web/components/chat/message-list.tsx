"use client"

import {
  LegendList,
  type LegendListRenderItemProps,
} from "@legendapp/list/react"
import { useCallback, useState } from "react"

import {
  ImagePreviewDialog,
  MessageImageGrid,
} from "@/components/chat/composer-attachments"
import { SkillInlineText } from "@/components/chat/skill-inline-text"
import { MOCK_SKILLS } from "@/lib/chat/skills"
import type { ChatMessage, ChatMessageAttachment } from "@/lib/chat/types"

type MessageListProps = {
  messages: ChatMessage[]
}

function keyExtractor(item: ChatMessage) {
  return item.id
}

function getItemType(item: ChatMessage) {
  return item.role
}

function MessageRow({
  message,
  onExpandImage,
}: {
  message: ChatMessage
  onExpandImage: (image: ChatMessageAttachment) => void
}) {
  const attachments = message.attachments ?? []

  switch (message.role) {
    case "user":
      return (
        <div className="flex justify-end py-2">
          <div className="max-w-[85%] rounded-2xl bg-primary/10 px-3 py-2 text-sm">
            <MessageImageGrid images={attachments} onExpand={onExpandImage} />
            {message.content.length > 0 ? (
              <p className="whitespace-pre-wrap">
                <SkillInlineText text={message.content} skills={MOCK_SKILLS} />
              </p>
            ) : attachments.length > 0 ? (
              <p className="text-muted-foreground text-xs italic">Attached image</p>
            ) : null}
          </div>
        </div>
      )
    case "assistant":
      return (
        <div className="flex justify-start py-2">
          <p className="max-w-[85%] text-sm whitespace-pre-wrap">
            <SkillInlineText text={message.content} skills={MOCK_SKILLS} />
          </p>
        </div>
      )
    default: {
      const _exhaustive: never = message.role
      return _exhaustive
    }
  }
}

function ComposerSpacer() {
  return <div className="h-36 shrink-0" aria-hidden />
}

export function MessageList({ messages }: MessageListProps) {
  const [expandedImage, setExpandedImage] = useState<ChatMessageAttachment | null>(
    null
  )

  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<ChatMessage>) => (
      <div className="mx-auto w-full max-w-3xl px-4">
        <MessageRow message={item} onExpandImage={setExpandedImage} />
      </div>
    ),
    []
  )

  return (
    <>
      <LegendList
        className="h-full min-h-0 overflow-x-hidden overscroll-y-contain [overflow-anchor:none]"
        style={{ height: "100%" }}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        estimatedItemSize={72}
        initialScrollAtEnd
        maintainScrollAtEnd
        maintainVisibleContentPosition
        recycleItems
        ListFooterComponent={ComposerSpacer}
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
