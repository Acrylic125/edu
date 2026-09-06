"use client"

import { useEffect, useState } from "react"

import { ChatComposerIsland } from "@/components/chat/chat-composer-island"
import { ChatFrame, ChatFrameStatus } from "@/components/chat/chat-frame"
import {
  ChatRealtimeProvider,
  useChatSend,
} from "@/components/chat/chat-socket-island"
import { ChatThreadIsland } from "@/components/chat/chat-thread-island"
import { MessageSkeletons } from "@/components/chat/message-skeletons"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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

const GRID_ORB_POSITIONS = [
  { x: "10%", y: "14%" },
  { x: "52%", y: "12%" },
  { x: "90%", y: "18%" },
  { x: "82%", y: "52%" },
  { x: "88%", y: "86%" },
  { x: "50%", y: "78%" },
  { x: "14%", y: "84%" },
  { x: "12%", y: "50%" },
] as const

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
  const [gridOrbPosition, setGridOrbPosition] = useState<number | null>(null)
  const [gridOrbVisible, setGridOrbVisible] = useState(false)
  const phase = useChatStore(selectShellPhase)
  const status = useChatStore(headerStatusSelector)
  const session = useChatStore((state) => state.session)
  const hasNoTopics = useChatStore(
    (state) =>
      state.catalog.order.length === 0 &&
      state.session.kind === "none" &&
      state.switch === null,
  )
  const store = useChatStoreApi()
  const error = useChatStore((state) => state.error)
  const topicCreation = useChatStore((state) => state.topicCreation)
  const { sendJsonMessage } = useChatSend()

  useEffect(() => {
    let timerId = 0
    let previousPosition = -1

    function revealOrb() {
      let nextPosition = Math.floor(Math.random() * GRID_ORB_POSITIONS.length)
      if (nextPosition === previousPosition) {
        nextPosition = (nextPosition + 1) % GRID_ORB_POSITIONS.length
      }
      previousPosition = nextPosition
      setGridOrbPosition(nextPosition)
      setGridOrbVisible(true)
      timerId = window.setTimeout(() => {
        setGridOrbVisible(false)
        timerId = window.setTimeout(() => {
          setGridOrbPosition(null)
          timerId = window.setTimeout(revealOrb, 800)
        }, 1000)
      }, 5000 + Math.floor(Math.random() * 2000))
    }

    timerId = window.setTimeout(revealOrb, 700)
    return () => {
      window.clearTimeout(timerId)
    }
  }, [])

  const hasPendingTopic = topicCreation !== null
  useEffect(() => {
    if (!hasPendingTopic) {
      return
    }
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue =
        "This topic wasn't created. Leaving will lose the pending topic creation."
    }
    window.addEventListener("beforeunload", warnBeforeLeaving)
    return () => {
      window.removeEventListener("beforeunload", warnBeforeLeaving)
    }
  }, [hasPendingTopic])

  let title = "Chat"
  if (phase.show === "thread" && phase.title) {
    title = phase.title
  }

  const isEmptyThread = phase.show === "thread" && phase.empty
  const showComposer = phase.show !== "error" && !hasNoTopics
  const gridOrb =
    gridOrbPosition === null ? null : GRID_ORB_POSITIONS[gridOrbPosition]

  function sendUserText(content: string, optionMessageId?: string) {
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
    if (optionMessageId) {
      state.setOptionPending(optionMessageId)
    }
    const topicId = activeTopicIdForSend(state.session)
    sendJsonMessage(
      WsChatClientMessageSchema.parse({
        type: "message",
        messageId: messageId,
        parts: [{ type: "text", content: text }],
        ...(topicId ? { topicId } : {}),
      }),
    )
  }

  let body = null
  if (hasNoTopics && phase.show !== "error") {
    body = (
      <div className="relative h-full min-h-0 overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <div className="empty-state-grid absolute inset-0" />
          <svg
            className="absolute inset-0 size-full text-primary"
            aria-hidden="true"
            preserveAspectRatio="none"
          >
            <defs>
              <pattern
                id="empty-state-highlight-grid"
                width="80"
                height="80"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 0 0 H 80 M 0 0 V 80"
                  fill="none"
                  stroke="white"
                  strokeWidth="2"
                />
              </pattern>
              <mask
                id="empty-state-highlight-mask"
                x="0"
                y="0"
                width="100%"
                height="100%"
                maskUnits="userSpaceOnUse"
                maskContentUnits="userSpaceOnUse"
              >
                <rect
                  width="100%"
                  height="100%"
                  fill="url(#empty-state-highlight-grid)"
                />
              </mask>
              <radialGradient id="empty-state-highlight-color">
                <stop offset="0" stopColor="currentColor" stopOpacity="0.3" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle
              cx={gridOrb?.x ?? "50%"}
              cy={gridOrb?.y ?? "50%"}
              r="46%"
              fill="url(#empty-state-highlight-color)"
              mask="url(#empty-state-highlight-mask)"
              className={cn(
                "transition-opacity duration-1000 ease-in-out motion-reduce:transition-none",
                gridOrbVisible ? "opacity-100" : "opacity-0",
              )}
            />
          </svg>
        </div>
        <div className="relative h-full overflow-y-auto">
          <div className="flex min-h-full items-center justify-center px-6 py-10">
            <ChatComposerIsland emptyState />
          </div>
        </div>
      </div>
    )
  } else if (phase.show === "skeleton") {
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
          onOption={(messageId, label) => {
            sendUserText(label, messageId)
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
              }),
            )
          }}
        />
      </div>
    )
  }

  return (
    <ChatFrame
      hideHeader={hasNoTopics && phase.show !== "error"}
      titleSlot={<span className="truncate">{title}</span>}
      statusSlot={
        status.label === "Online" ? null : (
          <div className="shrink-0 text-xs">
            <ChatFrameStatus label={status.label} tone={status.tone} />
          </div>
        )
      }
      planSession={session}
      body={
        <>
          {body}
          {showComposer ? (
            <div
              className={cn(
                "pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center px-4 transition-[bottom,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
                isEmptyThread
                  ? "bottom-1/2 translate-y-1/2"
                  : "bottom-4 translate-y-0",
              )}
            >
              <div
                className={cn(
                  "overflow-hidden text-center transition-all duration-300 ease-out",
                  isEmptyThread && !hasNoTopics
                    ? "mb-8 max-h-24 translate-y-0 opacity-100"
                    : "mb-0 max-h-0 -translate-y-2 opacity-0",
                )}
              >
                <p className="text-xl font-medium tracking-tight">New chat</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Send a message to get started.
                </p>
              </div>

              <div className="pointer-events-auto w-full max-w-3xl">
                {error ? (
                  <Alert variant="destructive" className="mb-3">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                {topicCreation?.status === "failed" ? (
                  <Alert
                    variant="destructive"
                    className="mb-3 bg-background/95"
                  >
                    <AlertDescription className="flex items-center justify-between gap-3">
                      <span>
                        {topicCreation.error ??
                          "The topic wasn't created. Please retry."}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => {
                          const messageId = clientMessageId()
                          store.getState().retryNewTopic(messageId)
                          sendJsonMessage(
                            WsChatClientMessageSchema.parse({
                              type: "message",
                              messageId: messageId,
                              parts: topicCreation.parts,
                            }),
                          )
                        }}
                      >
                        Retry
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : null}
                <ChatComposerIsland emptyState={hasNoTopics} />
              </div>
            </div>
          ) : null}
        </>
      }
    />
  )
}
