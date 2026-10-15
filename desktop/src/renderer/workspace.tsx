import { useEffect, useRef, useState } from "react"
import {
  ArrowUp,
  Archive,
  ArchiveRestore,
  AtSign,
  Check,
  FolderOpen,
  FileText,
  LoaderCircle,
  Paperclip,
  Plus,
  RotateCcw,
  Settings,
  Square,
  X,
} from "lucide-react"
import {
  ChatComposerLayout,
  ChatConversation,
  ChatEmptyState,
  ChatMessage,
  ChatPanel,
  ChatSessions,
  ChatThinking,
  restoreChatFocus,
} from "@edu/ui/chat"
import {
  LearningDocumentLayout,
  LearningSuggestions,
  NewTopicView,
} from "@edu/ui/learning"
import {
  TopicNavigation,
  TopicNavigationItem,
  WorkspaceFrame,
  WorkspacePanes,
  WorkspaceSidebar,
  useWorkspaceLayout,
} from "@edu/ui/workspace"
import { DesktopSettings, ProviderConnectionSetup } from "./settings/settings"
import appIcon from "./assets/app-icon.png"
import { useWorkspace, desktop, desktopErrorMessage } from "./store"
import { useChatTabs } from "./chat-tabs"
import { useTopicViews } from "./topic-views"
import { StudyMarkdown } from "./markdown"
import { TopicDirectory } from "./topic-directory"
import { ProviderModelPicker } from "./provider-model-picker"
import { TopicMentionInput } from "./topic-mention-input"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@edu/ui/context-menu"
import { z } from "zod"
import { type MaterialDraftSchema, type RunnerSchema, type Snapshot } from "../shared/contracts"
import { topicMention } from "../shared/topic-mentions"
import { parseTopicDirectory } from "../shared/topic-directory"

export function App() {
  const { snapshot, loaded, providerSetupComplete, error, setError } = useWorkspace()
  const [setupProvider, setSetupProvider] = useState<Snapshot["providers"][number]["id"]>()
  const [view, setView] = useState<"learn" | "settings">("learn")
  const { activeId: topicId, select: selectTopic } = useTopicViews()
  const { activeId: chatId, openIds, select: selectChat, close: closeChat } = useChatTabs()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [topicMaterials, setTopicMaterials] = useState<z.infer<typeof MaterialDraftSchema>[]>([])
  // Lexical owns the editor content, so replacing a draft from outside remounts its composer.
  const [resets, setResets] = useState<Record<string, number>>({})
  const [focused, setFocused] = useState<string>()
  const [runnerId, setRunnerId] = useState("")
  const [runnerChoice, setRunnerChoice] =
    useState<
      Pick<
        z.infer<typeof RunnerSchema>,
        "provider" | "model" | "reasoningEffort"
      >
    >()
  const [busy, setBusy] = useState(false)
  const [submitting, setSubmitting] = useState<string>()
  const draftValues = useRef(drafts)
  draftValues.current = drafts
  const [draggingOver, setDraggingOver] = useState<string>()
  const thread = useRef<HTMLDivElement>(null)
  const topic = snapshot.topics.find((item) => item.id === topicId)
  const chat = snapshot.chats.find((item) => item.id === chatId)
  const taggedTopicIds = new Set(chat?.messages.flatMap((message) => message.topicIds) ?? [])
  const chatMaterials = [
    ...(chat?.materials ?? []),
    ...snapshot.topics.filter((item) => taggedTopicIds.has(item.id)).flatMap((item) => item.materials),
  ]
  const hasChat = topic !== undefined || snapshot.chats.length > 0 || openIds?.includes("new")
  const chatKey = chat?.id ?? "new-chat"

  let newRunner: string | undefined = runnerId || snapshot.runners[0]?.id
  if (runnerChoice)
    newRunner = snapshot.runners.find(
      (runner) =>
        runner.provider === runnerChoice.provider &&
        runner.model === runnerChoice.model &&
        runner.reasoningEffort === runnerChoice.reasoningEffort,
    )?.id
  const newRunnerConfig = snapshot.runners.find((item) => item.id === newRunner)
  const newModel = runnerChoice ??
    newRunnerConfig ?? { provider: "codex" as const, model: "default" }
  const chatRunnerConfig = snapshot.runners.find(
    (item) => item.id === (chat?.runnerId ?? newRunner),
  )
  let chatModel = newModel
  if (chat && chatRunnerConfig) chatModel = chatRunnerConfig
  const runtime = snapshot.runtime.find(
    (item) => item.runnerId === chatRunnerConfig?.id,
  )
  const chatRunnerBusy = runtime?.status === "running"
  const newRunnerBusy = snapshot.runtime.some(
    (item) => item.runnerId === newRunner && item.status === "running",
  )
  const chatRunning = chatRunnerBusy && !!chat && runtime.chatId === chat.id
  const chatError = chat && runtime?.chatId === chat.id ? runtime.error : undefined
  const newModelConnected = snapshot.providers.some(
    (provider) => provider.id === newModel.provider && provider.connected,
  )
  const chatModelConnected = snapshot.providers.some(
    (provider) => provider.id === chatModel.provider && provider.connected,
  )

  useEffect(() => {
    thread.current?.scrollTo({
      top: thread.current.scrollHeight,
      behavior: "instant",
    })
  }, [chatId, chat?.messages.length])

  useEffect(() => {
    if (view !== "learn" || !loaded) return
    let cycleContext: "chat" | "topic" | null = null
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || !event.ctrlKey || event.altKey || event.metaKey) return
      const inChat = document.activeElement?.closest("[data-chat-context]")
      if (document.querySelector('[role="dialog"]') && !inChat) return
      event.preventDefault()
      // A view change may unmount the focused editor; held Ctrl must keep its original context.
      cycleContext ??= inChat ? "chat" : "topic"
      if (cycleContext === "chat") {
        useChatTabs.getState().cycle(event.shiftKey)
        restoreChatFocus()
      } else {
        const topics = useWorkspace.getState().snapshot.topics.filter((item) => !item.archived)
        if (topics.length === 0) return
        const reverse = event.shiftKey
        const views = useTopicViews.getState()
        const index = topics.findIndex((item) => item.id === views.activeId)
        if (index < 0) {
          let next = topics[0]
          if (reverse) next = topics[topics.length - 1]
          views.select(next.id)
        } else {
          const direction = reverse ? -1 : 1
          views.select(topics[(index + direction + topics.length) % topics.length].id)
        }
      }
      setError(null)
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.key === "Control") commit()
    }
    function commit() {
      useChatTabs.getState().commitCycle()
      cycleContext = null
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", commit)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", commit)
      commit()
    }
  }, [view, loaded, setError])

  async function perform(operation: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await operation()
      return true
    } catch (failure) {
      setError(
        failure instanceof Error
          ? desktopErrorMessage(failure)
          : "This action failed. Try again.",
      )
      return false
    } finally {
      setBusy(false)
    }
  }

  function openTopic(id?: string) {
    selectTopic(id)
    setView("learn")
    setError(null)
  }

  function openChat(id?: string) {
    selectChat(id ?? "new")
    setError(null)
  }

  function replaceDraft(key: string, value: string) {
    draftValues.current = { ...draftValues.current, [key]: value }
    setDrafts((current) => ({ ...current, [key]: value }))
    setResets((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }))
    setFocused(key)
  }

  async function newRunnerId() {
    if (!runnerChoice && newRunner) return newRunner
    const match = snapshot.runners.find(
      (runner) =>
        runner.provider === newModel.provider &&
        runner.model === newModel.model &&
        runner.reasoningEffort === newModel.reasoningEffort,
    )
    if (match) return match.id
    const id = await desktop().addRunner({
      name: `${snapshot.providers.find((provider) => provider.id === newModel.provider)?.name ?? newModel.provider} tutor`,
      ...newModel,
    })
    setRunnerId(id)
    setRunnerChoice(undefined)
    return id
  }

  async function ensureChat() {
    if (chat) return chat.id
    const id = await desktop().createChat({ runnerId: await newRunnerId() })
    openChat(id)
    setDrafts((current) => ({
      ...current,
      "new-chat": "",
      [id]: current["new-chat"] ?? "",
    }))
    return id
  }

  async function sendChat() {
    let content = (drafts[chatKey] ?? "").trim()
    if (chatRunnerBusy || busy || !chatModelConnected) return
    if (!content) {
      if (!chat?.materials.length) return
      content = `Help me understand the attached materials: ${chat.materials.map((material) => material.name).join(", ")}.`
    }
    let sentId = chatKey
    const submittedDraft = drafts[chatKey] ?? ""
    setSubmitting(chatKey)
    try {
      const success = await perform(async () => {
        sentId = await ensureChat()
        await desktop().send({ chatId: sentId, content, openedTopicId: topic?.id })
      })
      // Typing stays available during submission; never erase edits made while IPC is pending.
      if (success && draftValues.current[sentId] === submittedDraft) replaceDraft(sentId, "")
    } finally {
      setSubmitting(undefined)
    }
  }

  async function startTopic() {
    let content = (drafts["new-topic"] ?? "").trim()
    if (newRunnerBusy || busy || !newModelConnected) return
    if (!content) {
      if (topicMaterials.length === 0) return
      content = `Help me learn the attached materials: ${topicMaterials.map((material) => material.name).join(", ")}.`
    }
    openTopic()
    let createdChat: string | undefined
    let submittedMessage = ""
    setSubmitting("new-topic")
    const success = await perform(async () => {
      const runner = await newRunnerId()
      const createdTopic = await desktop().createTopic({ title: content, runnerId: runner })
      const title = (await desktop().snapshot()).topics.find((item) => item.id === createdTopic)?.title ?? "New topic"
      if (topicMaterials.length > 0) {
        await desktop().importMaterials({ kind: "topic", id: createdTopic }, topicMaterials.map((material) => material.id))
        setTopicMaterials([])
      }
      const chatId = await desktop().createChat({ runnerId: runner })
      createdChat = chatId
      const message = `${topicMention(createdTopic, title)} ${content}`
      submittedMessage = message
      selectTopic(createdTopic)
      selectChat(chatId)
      // The new-topic composer is replaced by the topic, so a failed send keeps the request in its chat.
      replaceDraft("new-topic", "")
      replaceDraft(chatId, message)
      await desktop().send({ chatId, content: message, openedTopicId: createdTopic })
    })
    setSubmitting(undefined)
    if (success && createdChat && draftValues.current[createdChat] === submittedMessage) replaceDraft(createdChat, "")
  }

  async function attachNewTopic() {
    await perform(async () => {
      const materials = await desktop().selectMaterials(topicMaterials.map((material) => material.id))
      setTopicMaterials(materials)
    })
  }

  function composer(mode: "topic" | "chat") {
    const key = mode === "topic" ? "new-topic" : chatKey
    const existing = mode === "chat" ? chat : undefined
    const draft = drafts[key] ?? ""
    const materials = mode === "topic" ? topicMaterials : existing?.materials ?? []
    let runnerBusy = chatRunnerBusy
    let model = chatModel
    let placeholder = "Ask anything, or type @ to tag a topic…"
    let submit = sendChat
    let attach = async () => {
      await perform(async () => {
        const id = await ensureChat()
        await desktop().importMaterials({ kind: "chat", id })
      })
    }
    if (mode === "topic") {
      runnerBusy = newRunnerBusy
      model = newModel
      placeholder = "What would you like to learn?"
      submit = startTopic
      attach = attachNewTopic
    }
    async function dropFiles(files: File[]) {
      await perform(async () => {
        if (mode === "topic") {
          const materials = await desktop().dropMaterials(files, topicMaterials.map((material) => material.id))
          setTopicMaterials(materials)
          return
        }
        const materials = await desktop().dropMaterials(files)
        const id = await ensureChat()
        await desktop().importMaterials({ kind: "chat", id }, materials.map((material) => material.id))
      })
    }
    const provider = snapshot.providers.find((provider) => provider.id === model.provider)
    const providerDisconnected = !provider?.connected && !provider?.loading
    const submittingComposer = submitting === key
    let submitLabel = "Send message"
    if (submittingComposer) {
      submitLabel = "Sending message"
      if (mode === "topic") submitLabel = "Creating topic"
    }
    const attachmentBusy = busy || (mode === "topic" && runnerBusy)
    return (
      <ChatComposerLayout
        aria-label={mode === "topic" ? "New topic composer" : "Chat composer"}
        newTopicMode={mode === "topic"}
        onDragEnterCapture={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return
          event.preventDefault()
          event.stopPropagation()
          if (!attachmentBusy) setDraggingOver(key)
        }}
        onDragOverCapture={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = attachmentBusy ? "none" : "copy"
          if (!attachmentBusy) setDraggingOver(key)
        }}
        onDragLeaveCapture={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
          setDraggingOver(undefined)
        }}
        onDragEndCapture={() => setDraggingOver(undefined)}
        onDropCapture={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return
          event.preventDefault()
          event.stopPropagation()
          setDraggingOver(undefined)
          const files = Array.from(event.dataTransfer.files)
          if (attachmentBusy || files.length === 0) return
          void dropFiles(files)
        }}
        overlay={draggingOver === key && !attachmentBusy && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center gap-2 rounded-[inherit] border-2 border-dashed border-primary bg-card/95 text-sm font-medium text-primary" role="status">
            <Paperclip className="size-4" />
            Drop files to attach
          </div>
        )}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        attachments={
          <>
            {providerDisconnected && (
              <div role="alert" className="m-3 flex items-center justify-between gap-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <span>{provider?.name ?? model.provider} is disconnected. Connect it or choose a connected provider before sending.</span>
                <button type="button" className="shrink-0 font-medium underline underline-offset-2" onClick={() => {
                  setSetupProvider(model.provider)
                  setView("settings")
                }}>Connect provider</button>
              </div>
            )}
            {materials.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-4 pt-3">
                {materials.map((material) => (
                  <span
                    key={material.id}
                    className="flex max-w-48 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
                  >
                    <FileText className="size-3.5 shrink-0" />
                    <span className="truncate">{material.name}</span>
                    {mode === "topic" && (
                      <button
                        type="button"
                        aria-label={`Remove ${material.name}`}
                        disabled={busy}
                        onClick={() => setTopicMaterials((current) => current.filter((item) => item.id !== material.id))}
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </>
        }
        input={
          <TopicMentionInput
            key={`${key}:${resets[key] ?? 0}`}
            label={mode === "topic" ? "Message your tutor" : "Message this chat"}
            initialValue={draft}
            topics={snapshot.topics}
            placeholder={placeholder}
            autoFocus={focused === key}
            className={mode === "topic" ? "min-h-28 max-h-40" : "min-h-16 max-h-40"}
            onChange={(value) => {
              draftValues.current = { ...draftValues.current, [key]: value }
              setDrafts((current) => ({ ...current, [key]: value }))
            }}
            onSubmit={() => {
              void submit()
            }}
          />
        }
        toolbar={
          <>
            <div className="flex min-w-0 items-center gap-1">
              <button
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                type="button"
                aria-label={mode === "topic" ? "Add learning materials" : "Attach files to this chat"}
                title="Attach files"
                disabled={attachmentBusy}
                onClick={() => {
                  void attach()
                }}
              >
                <Paperclip className="size-4" />
              </button>
              <ProviderModelPicker
                value={model}
                disabled={busy || runnerBusy}
                lockProvider={!!existing}
                onSetup={(provider) => {
                  setSetupProvider(provider)
                  setView("settings")
                  setError(null)
                }}
                onChange={(choice) => {
                  if (existing && chatRunnerConfig)
                    void perform(() =>
                      desktop().updateRunner(chatRunnerConfig.id, {
                        ...chatRunnerConfig,
                        ...choice,
                      }),
                    )
                  else setRunnerChoice(choice)
                }}
              />
            </div>
            {existing && chatRunning ? (
              <button
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"
                type="button"
                aria-label="Stop runner"
                onClick={() => {
                  void perform(() => desktop().stopRunner(existing.runnerId))
                }}
              >
                <Square className="size-4" fill="currentColor" />
              </button>
            ) : (
              <button
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
                type="submit"
                aria-label={submitLabel}
                aria-busy={submittingComposer}
                disabled={(!draft.trim() && materials.length === 0) || busy || runnerBusy || !provider?.connected}
              >
                {submittingComposer ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              </button>
            )}
          </>
        }
      />
    )
  }

  const sessionProps = {
    sessions: snapshot.chats,
    openIds: openIds ?? [],
    activeId: chatId,
    onSelect: openChat,
    onNew: () => openChat(),
    onClose: closeChat,
  }
  const newTopicContent = (
    <NewTopicView>
      <LearningSuggestions
        disabled={busy || newRunnerBusy}
        onSelect={(prompt) => {
          openTopic()
          replaceDraft("new-topic", prompt)
        }}
      />
      {composer("topic")}
      {submitting === "new-topic" && <ChatThinking className="mt-3 text-center">Creating your topic…</ChatThinking>}
    </NewTopicView>
  )
  const chatPane = (
    <ChatSessions {...sessionProps}>
      <ChatPanel composer={composer("chat")}>
        {!chat || (chat.messages.length === 0 && !chatRunning && !chatError) ? (
          <ChatEmptyState
            title="Start a chat"
            description={topic
              ? "The open topic's notes and sources are included. Type @ to bring another topic into this chat."
              : "Ask anything. Type @ to bring a topic's notes and sources into this chat."}
            onPrompt={(prompt) => replaceDraft(chatKey, prompt)}
          />
        ) : (
          <ChatConversation ref={thread} className="px-4">
            {chat.messages.map((message) => (
              <ChatMessage key={message.id} role={message.role} copyText={message.content} onCopy={window.prune?.copyText}>
                <StudyMarkdown
                  text={message.content}
                  topics={snapshot.topics}
                  onOpenTopic={openTopic}
                  materials={chatMaterials}
                  onOpenMaterial={(id) => { void perform(() => desktop().openMaterial(id)) }}
                />
              </ChatMessage>
            ))}
            {chatRunning && (
              <ChatThinking>
                {runtime.activity}
              </ChatThinking>
            )}
            {chatError && (
              <div
                className="my-4 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
                role="alert"
              >
                <p>{chatError}</p>
                <button
                  className="mt-3 flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
                  disabled={busy || !chatModelConnected}
                  onClick={() => {
                    void perform(() =>
                      desktop().send({
                        chatId: chat.id,
                        content:
                          "Retry my last request using the saved handoff. Do not skip a pending question.",
                        openedTopicId: topic?.id,
                      }),
                    )
                  }}
                >
                  <RotateCcw className="size-3.5" />
                  Retry
                </button>
              </div>
            )}
            {chatError && runtime?.traceId && (
              <details className="my-4 rounded-lg border border-border text-xs text-muted-foreground">
                <summary className="cursor-pointer px-3 py-2.5">
                  Diagnostics · {runtime.traceId.slice(0, 8)}
                </summary>
                <div className="border-t border-border p-3">
                  <p className="mb-3">Trace {runtime.traceId}</p>
                  <ol className="max-h-56 space-y-3 overflow-auto font-mono">
                    {runtime.diagnostics?.map((entry, index) => (
                      <li key={`${entry.time}-${index}`}>
                        <p>
                          {entry.time.slice(11, 23)} · {entry.event}
                        </p>
                        <pre className="mt-1 whitespace-pre-wrap break-words text-[11px]">
                          {JSON.stringify(entry.details, null, 2)}
                        </pre>
                      </li>
                    ))}
                  </ol>
                  <button
                    className="mt-3 rounded-md border border-border px-3 py-1.5 text-foreground"
                    onClick={() =>
                      void perform(() => desktop().openDiagnostics(chat.id))
                    }
                  >
                    Open trace folder
                  </button>
                  <p className="mt-2">
                    Tool calls, validation results, recovery attempts, and
                    save status. Conversation content and credentials are
                    excluded.
                  </p>
                </div>
              </details>
            )}
          </ChatConversation>
        )}
      </ChatPanel>
    </ChatSessions>
  )

  let content
  if (!loaded) {
    content = (
      <main className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
        Loading your workspace…
      </main>
    )
  } else if (!topic) {
    content = (
      <WorkspacePanes
        chatLabel="Tutor chat"
        status={chatRunning ? "Working" : "Ready to learn"}
        body={newTopicContent}
        chat={hasChat ? chatPane : undefined}
      />
    )
  } else {
    const notes = parseTopicDirectory(
      topic.learning.notes.replace(/^# .+\n+/, ""),
    )
    content = (
      <WorkspacePanes
        chatLabel="Tutor chat"
        status={chatRunning ? "Working" : "Ready to learn"}
        documentActions={
          <div className="absolute right-4 top-4 z-10 flex gap-1">
            <button
              className="rounded-full p-2 text-muted-foreground hover:bg-accent"
              aria-label="Open workspace in Finder"
              title="Open workspace in Finder"
              onClick={() =>
                void perform(() => desktop().openWorkspace(topic.id))
              }
            >
              <FolderOpen className="size-4" />
            </button>
          </div>
        }
        body={
          <LearningDocumentLayout
            title={topic.title}
            materials={
              topic.materials.length > 0
                ? topic.materials.map((material) => (
                    <span
                      key={material.id}
                      className="flex max-w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground"
                    >
                      <FileText className="size-4 shrink-0" />
                      <span className="truncate">{material.name}</span>
                    </span>
                  ))
                : null
            }
            actions={
              !topic.planConfirmed &&
              topic.learning.outline.length > 0 && (
                <div className="mt-9">
                  <p className="mb-3 text-sm text-muted-foreground">
                    Review the scope and order. You can ask for changes in chat.
                  </p>
                  <button
                    className="flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    disabled={busy || chatRunnerBusy || !chatModelConnected}
                    onClick={() => {
                      void perform(async () => {
                        const id = await ensureChat()
                        await desktop().send({
                          chatId: id,
                          content: `${topicMention(topic.id, topic.title)} I confirm this learning plan. Begin at the suggested starting point.`,
                          confirmTopicId: topic.id,
                          openedTopicId: topic.id,
                        })
                      })
                    }}
                  >
                    <Check className="size-4" />
                    Confirm plan & begin
                  </button>
                </div>
              )
            }
          >
            <StudyMarkdown text={notes.before} materials={topic.materials} onOpenMaterial={(id) => { void perform(() => desktop().openMaterial(id)) }} />
            {notes.directory && (
              <TopicDirectory
                heading={notes.directory.heading}
                items={notes.directory.items}
                currentSection={topic.learning.currentSection}
              />
            )}
            {notes.after.trim() && <StudyMarkdown text={notes.after} materials={topic.materials} onOpenMaterial={(id) => { void perform(() => desktop().openMaterial(id)) }} />}
          </LearningDocumentLayout>
        }
        chat={chatPane}
      />
    )
  }

  if (loaded && !providerSetupComplete) {
    return <ProviderConnectionSetup snapshot={snapshot} />
  }

  if (loaded && view === "settings") {
    return (
      <DesktopSettings
        initialProvider={setupProvider}
        snapshot={snapshot}
        onBack={() => {
          setView("learn")
          setSetupProvider(undefined)
        }}
      />
    )
  }

  return (
    <>
      <WorkspaceFrame
        title={topic?.title ?? "New topic"}
        workspaceId={topic?.id ?? "new"}
        appName="EdU"
        nativeTitlebar={navigator.userAgent.includes("Macintosh")}
        hasChat={view === "learn" && hasChat}
        sidebar={
          <DesktopSidebar
            snapshot={snapshot}
            topicId={topicId}
            view={view}
            onOpenTopic={openTopic}
            onTagTopic={(item) => {
              const draft = draftValues.current[chatKey] ?? ""
              const separator = draft && !/\s$/.test(draft) ? " " : ""
              replaceDraft(chatKey, `${draft}${separator}${topicMention(item.id, item.title)} `)
              if (!chat) openChat()
            }}
            onArchiveTopic={(item) => {
              void perform(() => desktop().archiveTopic({ topicId: item.id, archived: !item.archived }))
            }}
            busy={busy}
            onOpenSettings={() => {
              setSetupProvider(undefined)
              setView("settings")
              setError(null)
            }}
          />
        }
        banner={
          error && (
            <div
              className="flex items-center justify-between gap-4 border-b border-destructive/20 bg-destructive/5 px-5 py-3 text-sm text-destructive"
              role="alert"
            >
              <span>{error}</span>
              <button
                className="shrink-0 rounded-md p-1 hover:bg-destructive/10"
                aria-label="Dismiss error"
                onClick={() => setError(null)}
              >
                <X className="size-4" />
              </button>
            </div>
          )
        }
      >
        {content}
      </WorkspaceFrame>
    </>
  )
}

function DesktopSidebar({
  snapshot,
  topicId,
  view,
  onOpenTopic,
  onOpenSettings,
  onTagTopic,
  onArchiveTopic,
  busy,
}: {
  snapshot: Snapshot
  topicId?: string
  view: "learn" | "settings"
  onOpenTopic: (id?: string) => void
  onOpenSettings: () => void
  onTagTopic: (topic: Snapshot["topics"][number]) => void
  onArchiveTopic: (topic: Snapshot["topics"][number]) => void
  busy: boolean
}) {
  const { closeNavigation, revealChat } = useWorkspaceLayout()
  const tagging = useRef(false)
  const activeTopics = snapshot.topics.filter((item) => !item.archived)
  const archivedTopics = snapshot.topics.filter((item) => item.archived)
  const runningChats = snapshot.chats.filter((chat) =>
    snapshot.runtime.some(
      (state) => state.chatId === chat.id && state.status === "running",
    ),
  )
  const runningTopicIds = new Set(
    runningChats.flatMap((chat) => {
      const latestTaggedRequest = chat.messages.findLast(
        (message) => message.role === "user" && message.topicIds.length > 0,
      )
      return latestTaggedRequest?.topicIds ?? []
    }),
  )

  function openTopic(id?: string) {
    closeNavigation()
    onOpenTopic(id)
  }

  function openSettings() {
    closeNavigation()
    onOpenSettings()
  }

  function topicItem(item: Snapshot["topics"][number]) {
    return (
      <ContextMenu key={item.id}>
        <ContextMenuTrigger
          render={
            <TopicNavigationItem
              title={item.title}
              selected={view === "learn" && item.id === topicId}
              busy={runningTopicIds.has(item.id)}
              onClick={() => openTopic(item.id)}
            />
          }
        />
        <ContextMenuContent finalFocus={() => {
          // The remounted composer takes focus when tagging; other actions return to the topic.
          const restoreTopicFocus = !tagging.current
          tagging.current = false
          return restoreTopicFocus
        }}>
          <ContextMenuItem onClick={() => {
            tagging.current = true
            closeNavigation()
            revealChat()
            onTagTopic(item)
          }}>
            <AtSign aria-hidden="true" />
            @Tag in chat
          </ContextMenuItem>
          <ContextMenuItem disabled={busy} onClick={() => onArchiveTopic(item)}>
            {item.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
            {item.archived ? "Unarchive Chat" : "Archive Chat"}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  return (
    <WorkspaceSidebar
      label="Workspace navigation"
      brand={
        <button
          onClick={() => openTopic()}
          className="flex items-center gap-3 rounded-xl text-left text-xl font-semibold tracking-tight"
        >
          <img src={appIcon} alt="" className="size-11 shrink-0 object-contain" />
          EdU
        </button>
      }
      footer={
        <button
          className="ml-auto rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Settings"
          title="Settings"
          onClick={openSettings}
        >
          <Settings className="size-5" />
        </button>
      }
    >
      <button
        className="mb-7 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-learning-yellow text-sm font-semibold text-learning-ink transition-colors hover:bg-accent"
        onClick={() => openTopic()}
      >
        <Plus className="size-4" aria-hidden="true" />
        New topic
      </button>
      <TopicNavigation empty={activeTopics.length === 0}>
        {activeTopics.map(topicItem)}
      </TopicNavigation>
      {archivedTopics.length > 0 && (
        <div className="mt-6 border-t border-sidebar-border pt-5">
          <TopicNavigation label="Archived chats" empty={false}>
            {archivedTopics.map(topicItem)}
          </TopicNavigation>
        </div>
      )}
    </WorkspaceSidebar>
  )
}
