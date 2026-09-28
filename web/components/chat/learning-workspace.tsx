"use client"

import { useEffect, useState } from "react"
import { FileTextIcon } from "lucide-react"

import { BlockNoteViewer } from "@/components/chat/blocknote-viewer"
import { ChatComposerIsland } from "@/components/chat/chat-composer-island"
import { ChatFrame, ChatFrameStatus } from "@/components/chat/chat-frame"
import { ChatRealtimeProvider, useChatSend } from "@/components/chat/chat-socket-island"
import { ChatThreadIsland } from "@/components/chat/chat-thread-island"
import { PlanDialog } from "@/components/chat/plan-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { activeTopicIdForSend } from "@/lib/chat/active-topic"
import { useSession } from "@/lib/auth-client"
import { patchTopicDocument } from "@/lib/chat/http"
import { clientMessageId } from "@/lib/chat/ids"
import { ChatStoreProvider, headerStatusSelector, selectShellPhase, useChatStore, useChatStoreApi } from "@/lib/chat/store"
import type { ChatBootstrap } from "@/lib/chat/types"
import { WsChatClientDecisionSchema, WsChatClientMessageSchema } from "@/lib/chat/ws-schema"

export function LearningWorkspace({ bootstrap }: { bootstrap: ChatBootstrap }) {
  return <ChatStoreProvider bootstrap={bootstrap}><ChatRealtimeProvider><WorkspaceShell /></ChatRealtimeProvider></ChatStoreProvider>
}

function WorkspaceShell() {
  const phase = useChatStore(selectShellPhase)
  const status = useChatStore(headerStatusSelector)
  const session = useChatStore((state) => state.session)
  const error = useChatStore((state) => state.error)
  const topicCreation = useChatStore((state) => state.topicCreation)
  const store = useChatStoreApi()
  const authSession = useSession()
  const { sendJsonMessage } = useChatSend()
  const [newViewFromTopicId, setNewViewFromTopicId] = useState<string | null | undefined>()

  const showNewView = session.kind === "none" || (newViewFromTopicId !== undefined && session.kind === "topic" && session.topicId === newViewFromTopicId)

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

  let documentBody
  if (phase.show === "error") {
    documentBody = <div className="flex h-full items-center justify-center px-6 text-sm text-destructive">{phase.message}</div>
  } else if (showNewView) {
    documentBody = <div className="flex h-full items-center justify-center px-8 text-center"><div className="max-w-md"><span className="mx-auto mb-5 flex size-12 items-center justify-center rounded-xl border border-border text-xl text-primary">✦</span><h1 className="text-2xl font-semibold tracking-tight">Start a learning document</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Describe what you want to learn in the chat. Your topic and its learning plan will appear here.</p></div></div>
  } else if (phase.show === "skeleton" || session.kind !== "topic") {
    documentBody = <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading document…</div>
  } else {
    const files = new Map<string, { name: string; url?: string }>()
    for (const message of phase.messages) {
      for (const part of message.parts) {
        if (part.type === "attachment") files.set(part.ref, { name: part.filename ?? "Attached file", url: part.url })
      }
    }
    documentBody = <div className="h-full overflow-y-auto"><article className="mx-auto w-full max-w-[850px] px-6 pb-24 pt-12 sm:px-12 lg:pt-16"><div className="mx-auto max-w-[700px]">
      <div className="flex items-start justify-between gap-4"><h1 data-document-title className="min-w-0 break-words text-3xl font-semibold leading-tight tracking-tight sm:text-[2.5rem]">{session.title || "Untitled topic"}</h1><PlanDialog session={session} /></div>
      {files.size > 0 ? <div className="mt-5 flex flex-wrap gap-2">{[...files].map(([id, file]) => file.url ? <a key={id} href={file.url} target="_blank" rel="noopener noreferrer" className="flex max-w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><FileTextIcon className="size-4 shrink-0" /><span className="truncate">{file.name}</span></a> : <span key={id} className="flex max-w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground"><FileTextIcon className="size-4 shrink-0" /><span className="truncate">{file.name}</span></span>)}</div> : null}
      {session.plan.length > 0 ? <nav className="mt-9 rounded-lg border border-border bg-card/40 px-5 py-5" aria-label="Table of contents"><h2 className="text-base font-semibold">Table of contents</h2><ol className="mt-3 space-y-2">{session.plan.map((step) => <li key={step.id} className="text-sm leading-snug text-muted-foreground" style={{ paddingLeft: step.parent ? "1.2rem" : undefined }}>{step.label}</li>)}</ol></nav> : null}
      <div className="mt-9">{session.document.markdown.trim() ? <BlockNoteViewer text={session.document.markdown} showBlockHandles /> : <p className="text-sm text-muted-foreground">Your learning document is ready for notes.</p>}</div>
      {session.plan.length > 1 ? <button type="button" className="mt-9 w-full rounded-md border border-border px-4 py-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => sendUserText("Continue to the next topic")}>Continue →</button> : null}
    </div></article></div>
  }

  const chatBody = <div className="flex h-full min-h-0 flex-col"><div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
    {!showNewView && phase.show === "thread" ? <ChatThreadIsland onOption={(messageId, label) => sendUserText(label, messageId)} onDecision={(proposalId, decision) => { const state = store.getState(); if (state.socket.status !== "ready" || state.run.status === "running") return; sendJsonMessage(WsChatClientDecisionSchema.parse({ type: "decision", proposalId, decision })) }} onSaveToDocument={async (_messageId, text) => {
      const token = authSession.data?.session.token
      const current = store.getState().session
      if (!token || current.kind !== "topic") throw new Error("Open a topic to save this response")
      const markdown = [current.document.markdown.trim(), text.trim()].filter(Boolean).join("\n\n")
      const document = await patchTopicDocument(token, current.topicId, markdown, current.document.updatedAt)
      store.getState().setDocument(current.topicId, document)
    }} /> : <div className="flex h-full items-center justify-center px-5 text-center text-sm leading-6 text-muted-foreground">Tell Prune what you want to learn, or add slides and tutorials below.</div>}
  </div><div className="shrink-0 border-t border-border p-3 sm:p-4">
    {error ? <Alert variant="destructive" className="mb-3"><AlertDescription>{error}</AlertDescription></Alert> : null}
    {topicCreation?.status === "failed" ? <Alert variant="destructive" className="mb-3"><AlertDescription className="flex items-center justify-between gap-3"><span>{topicCreation.error ?? "The topic wasn't created. Please retry."}</span><Button type="button" variant="outline" size="sm" onClick={() => { const messageId = clientMessageId(); store.getState().retryNewTopic(messageId); sendJsonMessage(WsChatClientMessageSchema.parse({ type: "message", messageId, parts: topicCreation.parts })) }}>Retry</Button></AlertDescription></Alert> : null}
    <ChatComposerIsland newTopicMode={showNewView} />
  </div></div>

  return <ChatFrame title={showNewView ? "New topic" : phase.show === "thread" ? phase.title : "Prune"} activeTopicId={!showNewView && session.kind === "topic" ? session.topicId : null} onNew={() => setNewViewFromTopicId(session.kind === "topic" ? session.topicId : null)} onSelectTopic={() => setNewViewFromTopicId(undefined)} statusSlot={status.label === "Online" ? "Ready to learn" : <ChatFrameStatus label={status.label} tone={status.tone} />} body={documentBody} chat={chatBody} />
}
