"use client"

import { useEffect, useState } from "react"
import { BookOpenIcon, FileTextIcon } from "lucide-react"

import { LearningBooks } from "@/components/learning/learning-books"
import { BlockNoteViewer } from "@/components/chat/blocknote-viewer"
import { ChatWorkspacePanes } from "@/components/chat/chat-frame"
import { ChatComposerIsland } from "@/components/chat/chat-composer-island"
import { ChatRealtimeProvider, useChatSend } from "@/components/chat/chat-socket-island"
import { ChatThreadIsland } from "@/components/chat/chat-thread-island"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { activeTopicIdForSend } from "@/lib/chat/active-topic"
import { useSession } from "@/lib/auth-client"
import { postSelectTopicStep } from "@/lib/chat/http"
import { clientMessageId } from "@/lib/chat/ids"
import { ChatStoreProvider, headerStatusSelector, selectShellPhase, useChatStore, useChatStoreApi } from "@/lib/chat/store"
import type { ChatBootstrap } from "@/lib/chat/types"
import { WsChatClientDecisionSchema, WsChatClientMessageSchema } from "@/lib/chat/ws-schema"
import { cn } from "@/lib/utils"

export function LearningWorkspace({ bootstrap }: { bootstrap: ChatBootstrap }) {
  return <ChatStoreProvider bootstrap={bootstrap}><ChatRealtimeProvider><WorkspaceShell /></ChatRealtimeProvider></ChatStoreProvider>
}

function WorkspaceShell() {
  const phase = useChatStore(selectShellPhase)
  const status = useChatStore(headerStatusSelector)
  const session = useChatStore((state) => state.session)
  const error = useChatStore((state) => state.error)
  const topicCreation = useChatStore((state) => state.topicCreation)
  const canSelectStep = useChatStore((state) => state.socket.status === "ready" && state.run.status !== "running")
  const store = useChatStoreApi()
  const authSession = useSession()
  const [selectingStep, setSelectingStep] = useState(false)
  const { sendJsonMessage } = useChatSend()

  const showNewView = session.kind === "none"

  useEffect(() => {
    if (!topicCreation) return
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = "This topic wasn't created. Leaving will lose the pending topic creation."
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
    sendJsonMessage(WsChatClientMessageSchema.parse({ type: "message", messageId, parts: [{ type: "text", content: text }], ...(topicId ? { topicId } : {}) }))
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
      {error ? <Alert variant="destructive" className="mb-3"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {topicCreation?.status === "failed" ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{topicCreation.error ?? "The topic wasn't created. Please retry."}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => {
              const messageId = clientMessageId()
              store.getState().retryNewTopic(messageId)
              sendJsonMessage(WsChatClientMessageSchema.parse({ type: "message", messageId, parts: topicCreation.parts }))
            }}>Retry</Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  )

  const connectionStatus = (
    <span role="status" className={cn("text-xs", status.tone === "destructive" ? "text-destructive" : "text-muted-foreground")}>
      {status.label === "Online" ? "Ready to learn" : status.label}
    </span>
  )

  let documentBody
  if (showNewView) {
    documentBody = (
      <div className="relative h-full overflow-y-auto">
        <div className={cn("absolute right-6 top-5 max-w-[calc(100%-3rem)] text-right", status.label === "Online" && "sr-only")}>{connectionStatus}</div>
        <div className="mx-auto flex min-h-full w-full max-w-[850px] flex-col justify-center px-5 py-12 sm:px-8 lg:px-10">
          <div className="mb-8 flex items-center justify-between gap-4 sm:mb-10">
            <div className="max-w-lg">
              <span className="mb-5 flex size-12 items-center justify-center rounded-full bg-learning-yellow text-primary"><BookOpenIcon className="size-5" aria-hidden="true" /></span>
              <h1 className="text-3xl font-semibold leading-[1.12] tracking-[-0.045em] sm:text-4xl lg:text-[2.75rem]">What will you<br className="hidden sm:block" /> learn today?</h1>
              <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">Drop in slides, tutorials and past year papers, or start with a question.</p>
            </div>
            <LearningBooks className="hidden w-[38%] max-w-60 shrink-0 sm:block" />
          </div>
          {alerts}
          <ChatComposerIsland newTopicMode />
          <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">Your materials, questions, and learning plan. All in one place.</p>
        </div>
      </div>
    )
  } else if (phase.show === "error") {
    documentBody = <div className="flex h-full items-center justify-center px-6 text-sm text-destructive">{phase.message}</div>
  } else if (phase.show === "skeleton" || session.kind !== "topic") {
    documentBody = <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading document…</div>
  } else {
    const files = new Map<string, { name: string; url?: string }>()
    for (const message of phase.messages) {
      for (const part of message.parts) {
        if (part.type === "attachment") files.set(part.ref, { name: part.filename ?? "Attached file", url: part.url })
      }
    }
    documentBody = <div data-document-scroll className="h-full overflow-y-auto"><article className="mx-auto w-full max-w-[850px] px-6 pb-24 pt-12 sm:px-12 lg:pt-16"><div className="mx-auto max-w-[700px]">
      <h1 data-document-title className="min-w-0 break-words text-3xl font-semibold leading-tight tracking-tight sm:text-[2.5rem]">{session.title || "Untitled topic"}</h1>
      {files.size > 0 ? <div className="mt-5 flex flex-wrap gap-2">{[...files].map(([id, file]) => file.url ? <a key={id} href={file.url} target="_blank" rel="noopener noreferrer" className="flex max-w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><FileTextIcon className="size-4 shrink-0" /><span className="truncate">{file.name}</span></a> : <span key={id} className="flex max-w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground"><FileTextIcon className="size-4 shrink-0" /><span className="truncate">{file.name}</span></span>)}</div> : null}
      {session.plan.length > 0 ? <nav className="mt-9 rounded-[1.5rem] bg-learning-sage/50 px-6 py-6" aria-label="Table of contents"><h2 className="text-base font-semibold">Table of contents</h2><ol className="mt-3 space-y-2">{session.plan.map((step) => <li key={step.id} className="text-sm leading-snug text-muted-foreground" style={{ paddingLeft: step.parent ? "1.2rem" : undefined }}><button type="button" aria-current={session.currentStepId === step.id ? "step" : undefined} disabled={selectingStep || !canSelectStep} className="w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-learning-circle aria-[current=step]:bg-learning-circle aria-[current=step]:font-medium aria-[current=step]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed" onClick={() => void selectStep(step.id)}>{step.label}</button></li>)}</ol></nav> : null}
      <div className="mt-9">{session.document.markdown.trim() ? <BlockNoteViewer text={session.document.markdown} showBlockHandles /> : <p className="text-sm text-muted-foreground">Your learning document is ready for notes.</p>}</div>
      {session.plan.length > 1 ? <button type="button" className="mt-9 w-full rounded-full bg-learning-yellow px-4 py-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => sendUserText("Continue to the next topic")}>Continue →</button> : null}
    </div></article></div>
  }

  const chatBody = <div className="relative h-full min-h-0 overflow-hidden"><div className="absolute inset-0 min-h-0 overflow-hidden">
    {!showNewView && phase.show === "thread" ? <ChatThreadIsland onOption={(messageId, label) => sendUserText(label, messageId)} onDecision={(proposalId, decision) => { const state = store.getState(); if (state.socket.status !== "ready" || state.run.status === "running") return; sendJsonMessage(WsChatClientDecisionSchema.parse({ type: "decision", proposalId, decision })) }} /> : <div className="flex h-full items-center justify-center px-5 text-center text-sm leading-6 text-muted-foreground">Tell Prune what you want to learn, or add slides and tutorials below.</div>}
  </div><div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex flex-col items-center px-4"><div className="pointer-events-auto w-full max-w-3xl">
    {alerts}
    <ChatComposerIsland newTopicMode={showNewView} />
  </div></div></div>

  return <ChatWorkspacePanes body={documentBody} chat={showNewView ? null : chatBody} status={<span className={status.tone === "destructive" ? "text-destructive" : undefined}>{status.label === "Online" ? "Ready to learn" : status.label}</span>} />
}
