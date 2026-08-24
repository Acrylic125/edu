"use client"

import { ChatComposer } from "@/components/chat/chat-composer"
import { TopicMenu } from "@/components/chat/topic-menu"
import { useChatSend } from "@/components/chat/chat-socket-island"
import { clientMessageId } from "@/lib/chat/ids"
import { useChatStore, useChatStoreApi } from "@/lib/chat/store"
import type { ChatMessageAttachment } from "@/lib/chat/types"
import {
  WsChatClientMessageSchema,
  WsChatClientStopSchema,
  type MessagePart,
} from "@/lib/chat/ws-schema"

export function ChatComposerIsland({ className }: { className?: string }) {
  const store = useChatStoreApi()
  const socket = useChatStore((state) => state.socket)
  const run = useChatStore((state) => state.run)
  const { sendJsonMessage } = useChatSend()

  return (
    <ChatComposer
      className={className}
      socket={socket}
      run={run}
      footerStart={<TopicMenu />}
      onSend={(content, attachments) => {
        const state = store.getState()
        if (
          state.sendGate(
            content,
            attachments.length > 0,
            true
          ) !== "send"
        ) {
          return
        }
        const text = content.trim()
        if (text === "" && attachments.length === 0) {
          return
        }
        const messageId = clientMessageId()
        state.stageUserMessage(messageId, text, attachments)
        const parts: MessagePart[] = []
        if (text.length > 0) {
          parts.push({ type: "text", content: text })
        }
        for (const attachment of attachments) {
          parts.push({ type: "attachment", ref: attachment.id })
        }
        try {
          sendJsonMessage(
            WsChatClientMessageSchema.parse({
              type: "message",
              message: messageId,
              parts,
            })
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
        state.stopLocal()
        if (runId === "") {
          return
        }
        sendJsonMessage(
          WsChatClientStopSchema.parse({
            type: "stop",
            runId,
          })
        )
      }}
    />
  )
}

export type { ChatMessageAttachment }
