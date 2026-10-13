"use client"

import { ChatComposer } from "@/components/chat/chat-composer"
import { useChatFrame } from "@/components/chat/chat-frame"
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
  newTopicMode = false,
  showSuggestions,
}: {
  className?: string
  newTopicMode?: boolean
  showSuggestions?: boolean
}) {
  const store = useChatStoreApi()
  const socket = useChatStore((state) => state.socket)
  const run = useChatStore((state) => state.run)
  const { sendJsonMessage, sendChatRequest } = useChatSend()
  const { drafts, setDraft } = useChatFrame()
  const session = useChatStore((state) => state.session)
  const draftId = session.kind === "topic" ? session.topicId : "new"

  return (
    <ChatComposer
      draft={drafts[draftId] ?? ""}
      onDraftChange={(value) => setDraft(draftId, value)}
      className={className}
      newTopicMode={newTopicMode}
      showSuggestions={showSuggestions}
      socket={socket}
      run={run}
      onSend={async (content, attachments) => {
        const state = store.getState()
        if (state.sendGate(content, attachments.length > 0, true) !== "send") {
          throw new Error("The tutor is not ready to receive a request yet.")
        }
        const text = newTopicMode
          ? `/new ${content.trim().replace(/^\/new\s*/i, "")}`
          : content.trim()
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
          await sendChatRequest(
            WsChatClientMessageSchema.parse({
              type: "message",
              messageId: messageId,
              parts,
              ...(topicId ? { topicId } : {}),
            }),
          )
        } catch (error) {
          const current = store.getState()
          if (current.run.status === "running" && current.run.runId === "") current.stopLocal()
          throw error
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
