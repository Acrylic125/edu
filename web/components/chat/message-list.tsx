"use client"

import {
  LegendList,
  type LegendListRenderItemProps,
} from "@legendapp/list/react"
import { useCallback } from "react"

import type { ChatMessage } from "@/lib/chat/types"

type MessageListProps = {
  messages: ChatMessage[]
}

function keyExtractor(item: ChatMessage) {
  return item.id
}

function getItemType(item: ChatMessage) {
  return item.role
}

function MessageRow({ message }: { message: ChatMessage }) {
  switch (message.role) {
    case "user":
      return (
        <div className="flex justify-end py-2">
          <p className="max-w-[85%] rounded-2xl bg-primary/10 px-3 py-2 text-sm whitespace-pre-wrap">
            {message.content}
          </p>
        </div>
      )
    case "assistant":
      return (
        <div className="flex justify-start py-2">
          <p className="max-w-[85%] text-sm whitespace-pre-wrap">
            {message.content}
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
  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<ChatMessage>) => (
      <div className="mx-auto w-full max-w-3xl px-4">
        <MessageRow message={item} />
      </div>
    ),
    []
  )

  return (
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
  )
}
