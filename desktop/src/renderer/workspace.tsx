import { useEffect, useRef, useState, type FormEvent } from "react"
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
  LearningPlan,
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
import {
  ProviderModelPicker,
} from "./provider-model-picker"
import { z } from "zod"
import { type RunnerSchema, type Snapshot } from "../shared/contracts"

export function App() {
  const { snapshot, loaded, error, setError } = useWorkspace()
  const [view, setView] = useState<"learn" | "settings">("learn")
  const [topicId, setTopicId] = useState<string>()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const draft = drafts[topicId ?? "new"] ?? ""
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
  const textarea = useRef<HTMLTextAreaElement>(null)
  const topic = snapshot.topics.find((item) => item.id === topicId)
  let selectedRunner: string | undefined =
    topic?.runnerId ?? (runnerId || snapshot.runners[0]?.id)
  if (!topic && runnerChoice)
    selectedRunner = snapshot.runners.find(
      (runner) =>
        runner.provider === runnerChoice.provider &&
        runner.model === runnerChoice.model &&
        runner.reasoningEffort === runnerChoice.reasoningEffort,
    )?.id
  const runtime = snapshot.runtime.find(
    (item) => item.runnerId === selectedRunner,
  )
  const running = runtime?.status === "running"
  const topicRunning = running && runtime.topicId === topicId
  const selectedRunnerConfig = snapshot.runners.find(
    (item) => item.id === selectedRunner,
  )
  const selectedModel = runnerChoice ??
    selectedRunnerConfig ?? { provider: "codex" as const, model: "default" }
  const providerConnected = snapshot.providers.some(
    (provider) => provider.id === selectedModel.provider && provider.connected,
  )

  useEffect(() => {
    thread.current?.scrollTo({
      top: thread.current.scrollHeight,
      behavior: "instant",
    })
  }, [topicId, topic?.messages.length])

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
    setRunnerChoice(undefined)
    setError(null)
  }

  function setDraft(value: string) {
    setDrafts((current) => ({ ...current, [topicId ?? "new"]: value }))
  }

  async function targetRunner() {
    if (topic) return topic.runnerId
    if (!runnerChoice && selectedRunner) return selectedRunner
    const match = snapshot.runners.find(
      (runner) =>
        runner.provider === selectedModel.provider &&
        runner.model === selectedModel.model &&
        runner.reasoningEffort === selectedModel.reasoningEffort,
    )
    if (match) return match.id
    const id = await desktop().addRunner({
      name:
        `${snapshot.providers.find((provider) => provider.id === selectedModel.provider)?.name ?? selectedModel.provider} tutor`,
      ...selectedModel,
    })
    setRunnerId(id)
    return id
  }

  async function send(event?: FormEvent) {
    event?.preventDefault()
    if (!draft.trim() || running || busy) return
    const content = draft.trim()
    let sentTopicId = topicId
    const success = await perform(async () => {
      const target = await targetRunner()
      let id = topicId
      if (!id) {
        const createdId = await desktop().createTopic({
          runnerId: target,
          title: content.slice(0, 100),
        })
        id = createdId
        setTopicId(id)
        setDrafts((current) => ({ ...current, new: "", [createdId]: draft }))
        setRunnerChoice(undefined)
      }
      sentTopicId = id
      await desktop().send({ topicId: id, content })
    })
    if (success && sentTopicId) {
      const id = sentTopicId
      setDrafts((current) => ({ ...current, [id]: "" }))
    }
  }

  async function attach() {
    await perform(async () => {
      const target = await targetRunner()
      let id = topicId
      if (!id) {
        const createdId = await desktop().createTopic({
          runnerId: target,
          title: draft.trim().slice(0, 100) || "New topic",
        })
        id = createdId
        setTopicId(id)
        setDrafts((current) => ({ ...current, new: "", [createdId]: draft }))
        setRunnerChoice(undefined)
      }
      await desktop().importMaterials(id)
    })
  }

  const composer = (
    <ChatComposerLayout
      newTopicMode={!topic}
      onSubmit={(event) => {
        void send(event)
      }}
      input={
        <>
          <label className="sr-only" htmlFor="message">
            Message your tutor
          </label>
          <textarea
            ref={textarea}
            id="message"
            value={draft}
            maxLength={30_000}
            className={`w-full flex-1 resize-none bg-transparent px-4 pb-3 pt-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground ${topic ? "min-h-16 max-h-40" : "min-h-28 max-h-40"}`}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={
              topic
                ? "Ask a question, or explain your understanding…"
                : "What would you like to learn?"
            }
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault()
                void send()
              }
            }}
            rows={topic ? 2 : 4}
          />
        </>
      }
      toolbar={
        <>
          <div className="flex min-w-0 items-center gap-1">
            <button
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
              type="button"
              aria-label="Add learning materials"
              title="Attach files"
              disabled={busy || running}
              onClick={() => {
                void attach()
              }}
            >
              <Paperclip className="size-4" />
            </button>
            {!topic && snapshot.runners.length > 1 && (
              <select
                className="max-w-48 rounded-md bg-transparent px-2 py-1 text-xs text-muted-foreground"
                aria-label="Runner for new topic"
                value={selectedRunner ?? ""}
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
              value={selectedModel}
              disabled={busy || running}
              lockProvider={!!topic}
              onChange={(choice) => {
                if (topic && selectedRunnerConfig)
                  void perform(() =>
                    desktop().updateRunner(selectedRunnerConfig.id, {
                      ...selectedRunnerConfig,
                      ...choice,
                    }),
                  )
                else setRunnerChoice(choice)
              }}
            />
          </div>
          {topicRunning ? (
            <button
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"
              type="button"
              aria-label="Stop runner"
              onClick={() => {
                void perform(() => desktop().stopRunner(runtime.runnerId))
              }}
            >
              <Square className="size-4" fill="currentColor" />
            </button>
          ) : (
            <button
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
              type="submit"
              aria-label="Send message"
              disabled={!draft.trim() || busy || running}
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </>
      }
    />
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
        body={
          <NewTopicView footer="Review your learning plan before your lesson begins.">
            <LearningSuggestions
              disabled={busy || running}
              onSelect={(prompt) => {
                setDraft(prompt)
                textarea.current?.focus()
              }}
            />
            {snapshot.topics.length === 0 && composer}
          </NewTopicView>
        }
        chat={snapshot.topics.length > 0 && (
          <ChatSessions
            sessions={snapshot.topics}
            onSelect={openTopic}
            onNew={() => openTopic()}
          >
            <ChatPanel composer={composer}>
              <ChatEmptyState />
            </ChatPanel>
          </ChatSessions>
        )}
      />
    )
  } else {
    content = (
      <WorkspacePanes
        chatLabel="Tutor chat"
        status={topicRunning ? "Working" : "Ready to learn"}
        documentActions={
          <button
            className="absolute right-4 top-4 rounded-full p-2 text-muted-foreground hover:bg-accent"
            aria-label="Open workspace in Finder"
            title="Open workspace in Finder"
            onClick={() =>
              void perform(() => desktop().openWorkspace(topic.id))
            }
          >
            <FolderOpen className="size-4" />
          </button>
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
            plan={
              topic.learning.outline.length > 0 ? (
                <LearningPlan
                  label="Learning plan"
                  items={topic.learning.outline.map((section, index) => ({
                    id: `${index}-${section}`,
                    label: section,
                    selected: section === topic.learning.currentSection,
                  }))}
                />
              ) : null
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
                    disabled={busy || running || !providerConnected}
                    onClick={() => {
                      void perform(() =>
                        desktop().send({
                          topicId: topic.id,
                          content:
                            "I confirm this learning plan. Begin at the suggested starting point.",
                          action: "confirm_plan",
                        }),
                      )
                    }}
                  >
                    <Check className="size-4" />
                    Confirm plan & begin
                  </button>
                </div>
              )
            }
          >
            <StudyMarkdown
              text={topic.learning.notes.replace(/^# .+\n+/, "")}
            />
          </LearningDocumentLayout>
        }
        chat={
          <ChatSessions
            sessions={snapshot.topics}
            activeId={topic.id}
            onSelect={openTopic}
            onNew={() => openTopic()}
          >
            <ChatPanel composer={composer}>
              <ChatConversation
                ref={thread}
                className="h-full min-h-0 overflow-y-auto px-4 pb-40 pt-4"
                role="log"
                aria-label="Conversation"
              >
                {topic.messages.length === 0 && <ChatEmptyState />}
                {topic.messages.map((message) => {
                  if (message.role === "user")
                    return (
                      <ChatMessage key={message.id} role="user">
                        <StudyMarkdown text={message.content} />
                      </ChatMessage>
                    )
                  return (
                    <ChatMessage key={message.id} role="assistant">
                      <StudyMarkdown text={message.content} />
                    </ChatMessage>
                  )
                })}
                {topicRunning && (
                  <div
                    className="flex items-center gap-2 py-4 text-xs text-muted-foreground"
                    role="status"
                  >
                    <LoaderCircle className="size-3.5 animate-spin" />
                    {runtime?.activity}
                  </div>
                )}
                {runtime?.error && runtime.topicId === topic.id && (
                  <div
                    className="my-4 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
                    role="alert"
                  >
                    <p>{runtime.error}</p>
                    <button
                      className="mt-3 flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
                      disabled={busy || !providerConnected}
                      onClick={() => {
                        void perform(() =>
                          desktop().send({
                            topicId: topic.id,
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
                {runtime?.error &&
                  runtime.traceId &&
                  runtime.topicId === topic.id && (
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
                            void perform(() =>
                              desktop().openDiagnostics(topic.id),
                            )
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
            </ChatPanel>
          </ChatSessions>
        }
      />
    )
  }

  if (loaded && view === "settings") {
    return <DesktopSettings snapshot={snapshot} busy={busy} perform={perform} onBack={() => setView("learn")} error={error} onDismissError={() => setError(null)} />
  }

  return (
    <>
      <WorkspaceFrame
        title={
          view === "settings" ? "Settings" : (topic?.title ?? "New topic")
        }
        hasChat={view === "learn" && snapshot.topics.length > 0}
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
            busy={snapshot.runtime.some(
              (state) =>
                state.topicId === item.id && state.status === "running",
            )}
            onClick={() => openTopic(item.id)}
          />
        ))}
      </TopicNavigation>
    </WorkspaceSidebar>
  )
}
