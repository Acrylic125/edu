"use client"

import { useEffect, useState } from "react"
import { FileTextIcon } from "lucide-react"
import { useRouter } from "next/navigation"

import {
  LearningDocumentLayout,
  LearningPlan,
  LearningSuggestions,
  NewTopicView,
} from "@edu/ui/learning"
import { ChatEmptyState, ChatPanel, ChatSessions } from "@edu/ui/chat"
import { WorkspacePanes } from "@edu/ui/workspace"
import { useChatFrame } from "@/components/chat/chat-frame"
import { BlockNoteViewer } from "@/components/chat/blocknote-viewer"
import { ChatComposerIsland } from "@/components/chat/chat-composer-island"
import {
  ChatRealtimeProvider,
  useChatSend,
} from "@/components/chat/chat-socket-island"
import { ChatThreadIsland } from "@/components/chat/chat-thread-island"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { activeTopicIdForSend } from "@/lib/chat/active-topic"
import { clientMessageId } from "@/lib/chat/ids"
import { useSession } from "@/lib/auth-client"
import { postSelectTopicStep } from "@/lib/chat/http"
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

export function LearningWorkspace({ bootstrap }: { bootstrap: ChatBootstrap }) {
  return (
    <ChatStoreProvider bootstrap={bootstrap}>
      <ChatRealtimeProvider>
        <WorkspaceShell />
      </ChatRealtimeProvider>
    </ChatStoreProvider>
  )
}

function WorkspaceShell() {
  const phase = useChatStore(selectShellPhase)
  const catalog = useChatStore((state) => state.catalog)
  const router = useRouter()
  const { setDraft } = useChatFrame()
  const status = useChatStore(headerStatusSelector)
  const session = useChatStore((state) => state.session)
  const error = useChatStore((state) => state.error)
  const topicCreation = useChatStore((state) => state.topicCreation)
  const canSelectStep = useChatStore(
    (state) =>
      state.socket.status === "ready" && state.run.status !== "running",
  )
  const store = useChatStoreApi()
  const authSession = useSession()
  const [selectingStep, setSelectingStep] = useState(false)
  const { sendJsonMessage } = useChatSend()

  const showNewView = session.kind === "none"

  useEffect(() => {
    if (!topicCreation) return
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue =
        "This topic wasn't created. Leaving will lose the pending topic creation."
    }
    window.addEventListener("beforeunload", warnBeforeLeaving)
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving)
  }, [topicCreation])

  function sendUserText(content: string, optionMessageId?: string) {
    const state = store.getState()
    if (state.sendGate(content, false, true) !== "send") return
    const text = content.trim()
    if (!text) return
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

  async function selectStep(stepId: string) {
    const state = store.getState()
    const token = authSession.data?.session.token
    if (!token || state.session.kind !== "topic" || selectingStep || state.socket.status !== "ready" || state.run.status === "running") return
    setSelectingStep(true)
    try {
      await postSelectTopicStep(token, state.session.topicId, stepId)
      store.getState().setCurrentStep(stepId)
    } catch {
      store.setState({ error: "Could not select that step. Please try again." })
    } finally {
      setSelectingStep(false)
    }
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
            <span>
              {topicCreation.error ?? "The topic wasn't created. Please retry."}
            </span>
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

  const connectionStatus = (
    <span
      role="status"
      className={cn(
        "text-xs",
        status.tone === "destructive"
          ? "text-destructive"
          : "text-muted-foreground",
      )}
    >
      {status.label === "Online" ? "Ready to learn" : status.label}
    </span>
  )

  let documentBody
  if (showNewView) {
    documentBody = (
      <NewTopicView
        status={
          <span className={status.label === "Online" ? "sr-only" : undefined}>
            {connectionStatus}
          </span>
        }
        introduction="Or tell Prune what you want to learn. Review the proposed plan before your lesson begins."
        footer="Your materials, questions, and learning plan. All in one place."
      >
        {alerts}
        <LearningSuggestions onSelect={(prompt) => setDraft("new", prompt)} />
        <ChatComposerIsland newTopicMode showSuggestions={false} />
      </NewTopicView>
    )
  } else if (phase.show === "error") {
    documentBody = (
      <div className="flex h-full items-center justify-center px-6 text-sm text-destructive">
        {phase.message}
      </div>
    )
  } else if (phase.show === "skeleton" || session.kind !== "topic") {
    documentBody = (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading document…
      </div>
    )
  } else {
    const files = new Map<string, { name: string; url?: string }>()
    for (const message of phase.messages) {
      for (const part of message.parts) {
        if (part.type === "attachment")
          files.set(part.ref, {
            name: part.filename ?? "Attached file",
            url: part.url,
          })
      }
    }
    documentBody = (
      <LearningDocumentLayout
        title={session.title || "Untitled topic"}
        materials={
          files.size > 0
            ? [...files].map(([id, file]) =>
                file.url ? (
                  <a
                    key={id}
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex max-w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <FileTextIcon className="size-4 shrink-0" />
                    <span className="truncate">{file.name}</span>
                  </a>
                ) : (
                  <span
                    key={id}
                    className="flex max-w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground"
                  >
                    <FileTextIcon className="size-4 shrink-0" />
                    <span className="truncate">{file.name}</span>
                  </span>
                ),
              )
            : null
        }
        plan={
          session.plan.length > 0 ? (
            <LearningPlan
              items={session.plan.map((step) => ({
                id: step.id,
                label: step.label,
                nested: !!step.parent,
                selected: session.currentStepId === step.id,
              }))}
              disabled={selectingStep || !canSelectStep}
              onSelect={(id) => void selectStep(id)}
            />
          ) : null
        }
        actions={
          session.plan.length > 1 ? (
            <Button
              variant="learning"
              size="auto"
              type="button"
              className="mt-9 w-full rounded-full border-0 px-4 py-3"
              onClick={() => sendUserText("Continue to the next topic")}
            >
              Continue learning →
            </Button>
          ) : null
        }
      >
        {session.document.markdown.trim() ? (
          <BlockNoteViewer text={session.document.markdown} showBlockHandles />
        ) : (
          <p className="text-sm text-muted-foreground">Your learning document is ready for notes.</p>
        )}
      </LearningDocumentLayout>
    )
  }

  const chatBody = (
    <ChatSessions
      sessions={catalog.order.flatMap((id) => {
        const topic = catalog.byId[id]
        if (!topic) return []
        return [{ id, title: topic.title }]
      })}
      activeId={session.kind === "topic" ? session.topicId : undefined}
      onSelect={(id) => router.push(`/chat/${encodeURIComponent(id)}`)}
      onNew={() => router.push("/chat")}
    >
      <ChatPanel
        composer={
          <ChatComposerIsland
            newTopicMode={showNewView}
            showSuggestions={false}
          />
        }
        alerts={showNewView ? null : alerts}
      >
        {!showNewView && phase.show === "thread" && !phase.empty ? (
          <ChatThreadIsland
            onOption={(messageId, label) => sendUserText(label, messageId)}
            onDecision={(proposalId, decision) => {
              const state = store.getState()
              if (
                state.socket.status !== "ready" ||
                state.run.status === "running"
              )
                return
              sendJsonMessage(
                WsChatClientDecisionSchema.parse({
                  type: "decision",
                  proposalId,
                  decision,
                }),
              )
            }}
          />
        ) : (
          <ChatEmptyState
            newTopic={showNewView}
            onPrompt={(prompt) => {
              const draftId = session.kind === "topic" ? session.topicId : "new"
              setDraft(draftId, prompt)
            }}
          />
        )}
      </ChatPanel>
    </ChatSessions>
  )

  return (
    <WorkspacePanes
      body={documentBody}
      chat={showNewView ? null : chatBody}
      status={
        <span
          className={
            status.tone === "destructive" ? "text-destructive" : undefined
          }
        >
          {status.label === "Online" ? "Ready to learn" : status.label}
        </span>
      }
    />
  )
}
