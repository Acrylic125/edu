import { useEffect, useRef, useState } from "react"
import {
  ArrowUp,
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
import { DesktopSettings } from "./settings/settings"
import appIcon from "./assets/app-icon.png"
import { useWorkspace, desktop } from "./store"
import { StudyMarkdown } from "./markdown"
import { TopicDirectory } from "./topic-directory"
import { ProviderModelPicker } from "./provider-model-picker"
import { TopicMentionInput } from "./topic-mention-input"
import { z } from "zod"
import { type RunnerSchema, type Snapshot } from "../shared/contracts"
import { stripTopicMentions, topicMention } from "../shared/topic-mentions"
import { parseTopicDirectory } from "../shared/topic-directory"

export function App() {
  const { snapshot, loaded, error, setError } = useWorkspace()
  const [view, setView] = useState<"learn" | "settings">("learn")
  const [topicId, setTopicId] = useState<string>()
  const [chatId, setChatId] = useState<string>()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
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
  const thread = useRef<HTMLDivElement>(null)
  const topic = snapshot.topics.find((item) => item.id === topicId)
  const chat = snapshot.chats.find((item) => item.id === chatId)
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
  const chatModelConnected = snapshot.providers.some(
    (provider) => provider.id === chatModel.provider && provider.connected,
  )

  useEffect(() => {
    thread.current?.scrollTo({
      top: thread.current.scrollHeight,
      behavior: "instant",
    })
  }, [chatId, chat?.messages.length])

  async function perform(operation: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await operation()
      return true
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "This action failed. Try again.",
      )
      return false
    } finally {
      setBusy(false)
    }
  }

  function openTopic(id?: string) {
    setTopicId(id)
    setView("learn")
    setError(null)
  }

  function openChat(id?: string) {
    setChatId(id)
    setError(null)
  }

  function replaceDraft(key: string, value: string) {
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
    setChatId(id)
    setDrafts((current) => ({
      ...current,
      "new-chat": "",
      [id]: current["new-chat"] ?? "",
    }))
    return id
  }

  async function sendChat() {
    const content = (drafts[chatKey] ?? "").trim()
    if (!content || chatRunnerBusy || busy) return
    let sentId = chatKey
    const success = await perform(async () => {
      sentId = await ensureChat()
      await desktop().send({ chatId: sentId, content })
    })
    if (success) replaceDraft(sentId, "")
  }

  async function startTopic() {
    const content = (drafts["new-topic"] ?? "").trim()
    if (!content || newRunnerBusy || busy) return
    let createdChat: string | undefined
    const success = await perform(async () => {
      const runner = await newRunnerId()
      const title = stripTopicMentions(content).slice(0, 100)
      const createdTopic = await desktop().createTopic({ title })
      const chatId = await desktop().createChat({ runnerId: runner })
      createdChat = chatId
      const message = `${topicMention(createdTopic, title)} ${content}`
      setTopicId(createdTopic)
      setChatId(chatId)
      // The new-topic composer is replaced by the topic, so a failed send keeps the request in its chat.
      replaceDraft("new-topic", "")
      replaceDraft(chatId, message)
      await desktop().send({ chatId, content: message })
    })
    if (success && createdChat) replaceDraft(createdChat, "")
  }

  async function attachNewTopic() {
    await perform(async () => {
      const content = (drafts["new-topic"] ?? "").trim()
      const title = stripTopicMentions(content).slice(0, 100) || "New topic"
      const createdTopic = await desktop().createTopic({ title })
      const createdChat = await desktop().createChat({
        runnerId: await newRunnerId(),
      })
      setTopicId(createdTopic)
      setChatId(createdChat)
      replaceDraft("new-topic", "")
      replaceDraft(createdChat, `${topicMention(createdTopic, title)} ${content}`)
      await desktop().importMaterials({ kind: "topic", id: createdTopic })
    })
  }

  function composer(mode: "topic" | "chat") {
    const key = mode === "topic" ? "new-topic" : chatKey
    const existing = mode === "chat" ? chat : undefined
    const draft = drafts[key] ?? ""
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
    return (
      <ChatComposerLayout
        newTopicMode={mode === "topic"}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        attachments={
          existing &&
          existing.materials.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pt-3">
              {existing.materials.map((material) => (
                <span
                  key={material.id}
                  className="flex max-w-48 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
                >
                  <FileText className="size-3.5 shrink-0" />
                  <span className="truncate">{material.name}</span>
                </span>
              ))}
            </div>
          )
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
            onChange={(value) =>
              setDrafts((current) => ({ ...current, [key]: value }))
            }
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
                disabled={busy || runnerBusy}
                onClick={() => {
                  void attach()
                }}
              >
                <Paperclip className="size-4" />
              </button>
              {!existing && snapshot.runners.length > 1 && (
                <select
                  className="max-w-48 rounded-md bg-transparent px-2 py-1 text-xs text-muted-foreground"
                  aria-label="Runner"
                  value={newRunner ?? ""}
                  onChange={(event) => {
                    setRunnerId(event.target.value)
                    setRunnerChoice(undefined)
                  }}
                >
                  {snapshot.runners.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              )}
              <ProviderModelPicker
                value={model}
                disabled={busy || runnerBusy}
                lockProvider={!!existing}
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
                aria-label="Send message"
                disabled={!draft.trim() || busy || runnerBusy}
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </>
        }
      />
    )
  }

  const chatPane = (
    <ChatSessions
      sessions={snapshot.chats}
      activeId={chat?.id}
      onSelect={openChat}
      onNew={() => openChat()}
    >
      <ChatPanel composer={composer("chat")}>
        {!chat || (chat.messages.length === 0 && !chatRunning && !chatError) ? (
          <ChatEmptyState
            title="Start a chat"
            description="Ask anything. Type @ to bring a topic's notes and sources into this chat."
            onPrompt={(prompt) => replaceDraft(chatKey, prompt)}
          />
        ) : (
          <ChatConversation ref={thread} className="px-4">
            {chat.messages.map((message) => (
              <ChatMessage key={message.id} role={message.role}>
                <StudyMarkdown
                  text={message.content}
                  topics={snapshot.topics}
                  onOpenTopic={openTopic}
                />
              </ChatMessage>
            ))}
            {chatRunning && (
              <div
                className="flex items-center gap-2 py-4 text-xs text-muted-foreground"
                role="status"
              >
                <LoaderCircle className="size-3.5 animate-spin" />
                {runtime.activity}
              </div>
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
        body={
          <NewTopicView>
            <LearningSuggestions
              disabled={busy || newRunnerBusy}
              onSelect={(prompt) => replaceDraft("new-topic", prompt)}
            />
            {composer("topic")}
          </NewTopicView>
        }
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
              className="rounded-full p-2 text-muted-foreground hover:bg-accent disabled:opacity-50"
              aria-label="Add sources to this topic"
              title="Add sources to this topic"
              disabled={busy}
              onClick={() =>
                void perform(() =>
                  desktop().importMaterials({ kind: "topic", id: topic.id }),
                )
              }
            >
              <Paperclip className="size-4" />
            </button>
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
            <StudyMarkdown text={notes.before} />
            {notes.directory && (
              <TopicDirectory
                heading={notes.directory.heading}
                items={notes.directory.items}
                currentSection={topic.learning.currentSection}
              />
            )}
            {notes.after.trim() && <StudyMarkdown text={notes.after} />}
          </LearningDocumentLayout>
        }
        chat={chatPane}
      />
    )
  }

  if (loaded && view === "settings") {
    return <DesktopSettings snapshot={snapshot} busy={busy} perform={perform} onBack={() => setView("learn")} error={error} onDismissError={() => setError(null)} />
  }

  return (
    <>
      <WorkspaceFrame
        title={topic?.title ?? "New topic"}
        workspaceId={topic?.id ?? "new"}
        appName="EdU"
        nativeTitlebar={navigator.userAgent.includes("Macintosh")}
        hasChat={view === "learn" && !!topic}
        sidebar={
          <DesktopSidebar
            snapshot={snapshot}
            topicId={topicId}
            view={view}
            onOpenTopic={openTopic}
            onOpenSettings={() => {
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
}: {
  snapshot: Snapshot
  topicId?: string
  view: "learn" | "settings"
  onOpenTopic: (id?: string) => void
  onOpenSettings: () => void
}) {
  const { closeNavigation } = useWorkspaceLayout()
  const runningChats = snapshot.chats.filter((chat) =>
    snapshot.runtime.some(
      (state) => state.chatId === chat.id && state.status === "running",
    ),
  )

  function openTopic(id?: string) {
    closeNavigation()
    onOpenTopic(id)
  }

  function openSettings() {
    closeNavigation()
    onOpenSettings()
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
      <TopicNavigation empty={snapshot.topics.length === 0}>
        {snapshot.topics.map((item) => (
          <TopicNavigationItem
            key={item.id}
            title={item.title}
            selected={view === "learn" && item.id === topicId}
            busy={runningChats.some((chat) =>
              chat.messages.some((message) => message.topicIds.includes(item.id)),
            )}
            onClick={() => openTopic(item.id)}
          />
        ))}
      </TopicNavigation>
    </WorkspaceSidebar>
  )
}
