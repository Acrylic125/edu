"use client"

import { useEffect, useState } from "react"
import { FileTextIcon, UploadCloudIcon } from "lucide-react"

import { ChatComposerIsland } from "@/components/chat/chat-composer-island"
import { ChatFrame, ChatFrameStatus } from "@/components/chat/chat-frame"
import { ChatRealtimeProvider, useChatSend } from "@/components/chat/chat-socket-island"
import { ChatThreadIsland } from "@/components/chat/chat-thread-island"
import { MessageSkeletons } from "@/components/chat/message-skeletons"
import { PlanDialog } from "@/components/chat/plan-dialog"
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
import { WsChatClientDecisionSchema, WsChatClientMessageSchema } from "@/lib/chat/ws-schema"

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
  const session = useChatStore((state) => state.session)
  const error = useChatStore((state) => state.error)
  const topicCreation = useChatStore((state) => state.topicCreation)
  const store = useChatStoreApi()
  const { sendJsonMessage } = useChatSend()
  const [newViewFromTopicId, setNewViewFromTopicId] = useState<string | null | undefined>(undefined)

  const showNewView =
    session.kind === "none" ||
    (newViewFromTopicId !== undefined &&
      session.kind === "topic" &&
      session.topicId === newViewFromTopicId)

  const hasPendingTopic = topicCreation !== null
  useEffect(() => {
    if (!hasPendingTopic) return
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = "This topic wasn't created. Leaving will lose the pending topic creation."
    }
    window.addEventListener("beforeunload", warnBeforeLeaving)
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving)
  }, [hasPendingTopic])

  function sendUserText(content: string, optionMessageId?: string) {
    const state = store.getState()
    if (state.sendGate(content, false, true) !== "send") return
    const text = content.trim()
    if (text === "") return
    const messageId = clientMessageId()
    state.stageUserMessage(messageId, text, [])
    if (optionMessageId) state.setOptionPending(optionMessageId)
    const topicId = activeTopicIdForSend(state.session)
    sendJsonMessage(
      WsChatClientMessageSchema.parse({
        type: "message",
        messageId,
        parts: [{ type: "text", content: text }],
        ...(topicId ? { topicId } : {}),
      }),
    )
  }

  const alerts = (
    <>
      {error ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {topicCreation?.status === "failed" ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{topicCreation.error ?? "The topic wasn't created. Please retry."}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const messageId = clientMessageId()
                store.getState().retryNewTopic(messageId)
                sendJsonMessage(
                  WsChatClientMessageSchema.parse({
                    type: "message",
                    messageId,
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
    </>
  )

  let body
  if (phase.show === "error") {
    body = <div className="flex h-full items-center justify-center px-6 text-sm text-destructive">{phase.message}</div>
  } else if (showNewView) {
    body = (
      <div className="flex h-full overflow-y-auto px-5 py-10 sm:px-8">
        <div className="m-auto w-full max-w-2xl">
          <div className="mb-8 flex flex-col items-center text-center">
            <span className="mb-5 flex size-14 items-center justify-center rounded-2xl border border-border bg-card text-primary">
              <UploadCloudIcon className="size-7" strokeWidth={1.5} />
            </span>
            <h1 className="max-w-lg text-2xl font-semibold tracking-tight sm:text-3xl">What would you like to learn?</h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              Add slides or tutorials, then tell Prune what you want to understand.
            </p>
          </div>
          {alerts}
          <ChatComposerIsland newTopicMode />
          <p className="mt-4 text-center text-xs text-muted-foreground">You can also drag files into the outline box.</p>
        </div>
      </div>
    )
  } else if (phase.show === "skeleton") {
    body = <MessageSkeletons />
  } else {
    const files = new Map<string, { name: string; url?: string }>()
    for (const message of phase.messages) {
      for (const part of message.parts) {
        if (part.type !== "attachment") continue
        files.set(part.ref, { name: part.filename ?? "Attached file", url: part.url })
      }
    }
    body = (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-5 pt-10 sm:px-10 sm:pt-14">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Learning topic</p>
                <h1 className="break-words text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{phase.title || "Untitled topic"}</h1>
              </div>
              <PlanDialog session={session} />
            </div>
            {files.size > 0 ? (
              <div className="mt-6 flex flex-wrap gap-2">
                {[...files].map(([id, file]) => (
                  file.url ? (
                    <a key={id} href={file.url} target="_blank" rel="noopener noreferrer" className="flex max-w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{file.name}</span>
                    </a>
                  ) : (
                    <span key={id} className="flex max-w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
                      <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{file.name}</span>
                    </span>
                  )
                ))}
              </div>
            ) : null}
            {session.kind === "topic" && session.plan.length > 0 ? (
              <section className="mt-8 rounded-xl border border-border bg-card/50 px-5 py-5 sm:px-6" aria-labelledby="contents-title">
                <h2 id="contents-title" className="text-base font-semibold">Table of contents</h2>
                <ol className="mt-4 max-h-48 space-y-2 overflow-y-auto pr-2">
                  {session.plan.map((step) => (
                    <li key={step.id} className="text-sm leading-snug" style={{ paddingLeft: step.parent ? "1rem" : undefined }}>
                      {step.label}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
            <div className="mt-8 border-t border-border pt-5">
              <p className="text-xs font-medium text-muted-foreground">Conversation</p>
            </div>
          </div>
          <div className="mx-auto max-w-4xl px-1 pb-56 sm:px-6">
            <ChatThreadIsland
              onOption={(messageId, label) => sendUserText(label, messageId)}
              onDecision={(proposalId, decision) => {
                const state = store.getState()
                if (state.socket.status !== "ready" || state.run.status === "running") return
                sendJsonMessage(WsChatClientDecisionSchema.parse({ type: "decision", proposalId, decision }))
              }}
            />
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pb-4 pt-10 sm:pb-6">
          <div className="pointer-events-auto mx-auto w-full max-w-3xl">
            {alerts}
            <ChatComposerIsland />
          </div>
        </div>
      </div>
    )
  }

  return (
    <ChatFrame
      title={showNewView ? "New topic" : phase.show === "thread" ? phase.title : "Prune"}
      activeTopicId={!showNewView && session.kind === "topic" ? session.topicId : null}
      onNew={() => setNewViewFromTopicId(session.kind === "topic" ? session.topicId : null)}
      onSelectTopic={() => setNewViewFromTopicId(undefined)}
      statusSlot={status.label === "Online" ? "Ready to learn" : <ChatFrameStatus label={status.label} tone={status.tone} />}
      body={body}
    />
  )
}
