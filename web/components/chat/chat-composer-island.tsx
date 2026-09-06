"use client"

import { ChatComposer } from "@/components/chat/chat-composer"
import { TopicMenu } from "@/components/chat/topic-menu"
import { useChatSend } from "@/components/chat/chat-socket-island"
import { activeTopicIdForSend } from "@/lib/chat/active-topic"
import { clientMessageId } from "@/lib/chat/ids"
import { useChatStore, useChatStoreApi } from "@/lib/chat/store"
import type { ChatMessageAttachment } from "@/lib/chat/types"
import {
  WsChatClientMessageSchema,
  WsChatClientStopSchema,
  type MessagePart,
} from "@/lib/chat/ws-schema"

export function ChatComposerIsland({
  className,
  emptyState = false,
}: {
  className?: string
  emptyState?: boolean
}) {
  const store = useChatStoreApi()
  const socket = useChatStore((state) => state.socket)
  const run = useChatStore((state) => state.run)
  const { sendJsonMessage } = useChatSend()

  return (
    <ChatComposer
      className={className}
      emptyState={emptyState}
      socket={socket}
      run={run}
      footerStart={<TopicMenu />}
      onSend={(content, attachments) => {
        const state = store.getState()
        if (state.sendGate(content, attachments.length > 0, true) !== "send") {
          return
        }
        const text = content.trim()
        if (text === "" && attachments.length === 0) {
          return
        }
        const messageId = clientMessageId()
        const parts: MessagePart[] = []
        if (text.length > 0) {
          parts.push({ type: "text", content: text })
        }
        for (const attachment of attachments) {
          parts.push({ type: "attachment", ref: attachment.id })
        }
        if (/^\/new(?:\s|$)/.test(text)) {
          state.stageNewTopic(messageId, text, attachments, parts)
        } else {
          state.stageUserMessage(messageId, text, attachments)
        }
        try {
          const topicId = activeTopicIdForSend(state.session)
          sendJsonMessage(
            WsChatClientMessageSchema.parse({
              type: "message",
              messageId: messageId,
              parts,
              ...(topicId ? { topicId } : {}),
            }),
          )
        } catch {
          store.getState().stopLocal()
        }
      }}
      onStop={() => {
        const state = store.getState()
        if (state.run.status !== "running") {
          return
        }
        const runId = state.run.runId
        if (runId === "") {
          return
        }
        sendJsonMessage(
          WsChatClientStopSchema.parse({
            type: "stop",
            runId,
          }),
        )
      }}
    />
  )
}

export type { ChatMessageAttachment }
