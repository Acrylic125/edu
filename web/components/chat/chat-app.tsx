"use client"

import { ChatComposerIsland } from "@/components/chat/chat-composer-island"
import { ChatFrame, ChatFrameStatus } from "@/components/chat/chat-frame"
import {
  ChatRealtimeProvider,
  useChatSend,
} from "@/components/chat/chat-socket-island"
import { ChatThreadIsland } from "@/components/chat/chat-thread-island"
import { MessageSkeletons } from "@/components/chat/message-skeletons"
import { clientMessageId } from "@/lib/chat/ids"
import { activeTopicIdForSend } from "@/lib/chat/active-topic"
import {
  ChatStoreProvider,
  headerStatusSelector,
  selectShellPhase,
  useChatStore,
  useChatStoreApi,
} from "@/lib/chat/store"
import type { ChatBootstrap } from "@/lib/chat/types"
import {
  WsChatClientDecisionSchema,
  WsChatClientMessageSchema,
} from "@/lib/chat/ws-schema"
import { cn } from "@/lib/utils"

export function ChatApp({ bootstrap }: { bootstrap: ChatBootstrap }) {
  return (
    <ChatStoreProvider bootstrap={bootstrap}>
      <ChatRealtimeProvider>
        <ChatAppShell />
      </ChatRealtimeProvider>
    </ChatStoreProvider>
  )
}

function ChatAppShell() {
  const phase = useChatStore(selectShellPhase)
  const status = useChatStore(headerStatusSelector)
  const store = useChatStoreApi()
  const { sendJsonMessage } = useChatSend()

  let title = "Chat"
  if (phase.show === "thread" && phase.title) {
    title = phase.title
  }

  const isEmptyThread = phase.show === "thread" && phase.empty
  const showComposer = phase.show !== "error"

  function sendUserText(content: string) {
    const state = store.getState()
    if (state.sendGate(content, false, true) !== "send") {
      return
    }
    const text = content.trim()
    if (text === "") {
      return
    }
    const messageId = clientMessageId()
    state.stageUserMessage(messageId, text, [])
    const topicId = activeTopicIdForSend(state.session)
    sendJsonMessage(
      WsChatClientMessageSchema.parse({
        type: "message",
        message: messageId,
        parts: [{ type: "text", content: text }],
        ...(topicId ? { topicId } : {}),
      })
    )
  }

  let body = null
  if (phase.show === "skeleton") {
    body = <MessageSkeletons />
  } else if (phase.show === "error") {
    body = (
      <div className="flex h-full items-center justify-center px-4">
        <p className="text-destructive text-sm">{phase.message}</p>
      </div>
    )
  } else {
    body = (
      <div className="absolute inset-0 min-h-0 overflow-hidden">
        <ChatThreadIsland
          onOption={(label) => {
            sendUserText(label)
          }}
          onDecision={(proposalId, decision) => {
            const state = store.getState()
            if (state.socket.status !== "ready") {
              return
            }
            if (state.run.status === "running") {
              return
            }
            sendJsonMessage(
              WsChatClientDecisionSchema.parse({
                type: "decision",
                proposalId,
                decision,
              })
            )
          }}
        />
      </div>
    )
  }

  return (
    <ChatFrame
      titleSlot={<span className="truncate">{title}</span>}
      statusSlot={<ChatFrameStatus label={status.label} tone={status.tone} />}
      body={
        <>
          {body}
          {showComposer ? (
            <div
              className={cn(
                "pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center px-4 transition-[bottom,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
                isEmptyThread
                  ? "bottom-1/2 translate-y-1/2"
                  : "bottom-4 translate-y-0"
              )}
            >
              <div
                className={cn(
                  "overflow-hidden text-center transition-all duration-300 ease-out",
                  isEmptyThread
                    ? "mb-8 max-h-24 translate-y-0 opacity-100"
                    : "mb-0 max-h-0 -translate-y-2 opacity-0"
                )}
              >
                <p className="text-xl font-medium tracking-tight">New chat</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Send a message to get started.
                </p>
              </div>

              <div className="pointer-events-auto w-full max-w-3xl">
                <ChatComposerIsland />
              </div>
            </div>
          ) : null}
        </>
      }
    />
  )
}
