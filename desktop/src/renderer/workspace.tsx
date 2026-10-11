import { useEffect, useRef, useState, type FormEvent } from "react"
import {
  ArrowUp,
  BookOpen,
  Calculator,
  Check,
  Code,
  Cpu,
  FolderOpen,
  Pencil,
  FileText,
  LoaderCircle,
  Paperclip,
  Play,
  Plus,
  RotateCcw,
  Settings,
  Square,
  Trash2,
  UserCircle,
  X,
} from "lucide-react"
import { useThemeMode } from "@/components/theme/theme-provider"
import { useWorkspace, desktop } from "./store"
import { StudyMarkdown } from "./markdown"
import {
  ProviderModelFields,
  ProviderModelPicker,
} from "./provider-model-picker"
import { z } from "zod"
import { type RunnerSchema } from "../shared/contracts"

const runnerStatusLabels = {
  running: "Working",
  ready: "Ready",
  error: "Needs attention",
  stopped: "Stopped",
}
const suggestions = [
  {
    label: "Learn calculus",
    description: "Limits, derivatives and integrals",
    prompt:
      "Help me learn calculus, starting with limits, derivatives and integrals.",
    icon: Calculator,
  },
  {
    label: "Explore automata",
    description: "From finite states to languages",
    prompt:
      "Help me learn automata and formal languages, starting with finite automata.",
    icon: Code,
  },
  {
    label: "Prepare for an exam",
    description: "Turn your papers into practice",
    prompt: "Help me prepare for my exam using my slides and past year papers.",
    icon: BookOpen,
  },
]

export function App() {
  const { snapshot, loaded, error, setError } = useWorkspace()
  const { mode, setMode } = useThemeMode()
  const [view, setView] = useState<"learn" | "runners">("learn")
  const [topicId, setTopicId] = useState<string>()
  const [draft, setDraft] = useState("")
  const [runnerId, setRunnerId] = useState("")
  const [runnerChoice, setRunnerChoice] =
    useState<
      Pick<
        z.infer<typeof RunnerSchema>,
        "provider" | "model" | "reasoningEffort"
      >
    >()
  const [dialogRunnerId, setDialogRunnerId] = useState<string>()
  const [dialogName, setDialogName] = useState("")
  const [dialogModel, setDialogModel] = useState<
    Pick<z.infer<typeof RunnerSchema>, "provider" | "model" | "reasoningEffort">
  >({ provider: "codex", model: "default" })
  const [busy, setBusy] = useState(false)
  const runnerDialog = useRef<HTMLDialogElement>(null)
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
  let dialogSaveLabel = "Add runner"
  if (dialogRunnerId) dialogSaveLabel = "Save changes"
  if (busy) dialogSaveLabel = "Saving…"
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
    setDraft("")
    setRunnerChoice(undefined)
    setError(null)
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
        selectedModel.provider === "codex" ? "Codex tutor" : "OpenRouter tutor",
      ...selectedModel,
    })
    setRunnerId(id)
    return id
  }

  async function send(event?: FormEvent) {
    event?.preventDefault()
    if (!draft.trim() || running || busy) return
    const content = draft.trim()
    const success = await perform(async () => {
      const target = await targetRunner()
      let id = topicId
      if (!id) {
        id = await desktop().createTopic({
          runnerId: target,
          title: content.slice(0, 100),
        })
        setTopicId(id)
        setRunnerChoice(undefined)
      }
      await desktop().send({ topicId: id, content })
    })
    if (success) setDraft("")
  }

  async function attach() {
    await perform(async () => {
      const target = await targetRunner()
      let id = topicId
      if (!id) {
        id = await desktop().createTopic({
          runnerId: target,
          title: draft.trim().slice(0, 100) || "New topic",
        })
        setTopicId(id)
        setRunnerChoice(undefined)
      }
      await desktop().importMaterials(id)
    })
  }

  const composer = (
    <form
      className={`relative flex w-full flex-col rounded-2xl border ${topic ? "min-h-28 border-border/80 bg-input/25 shadow-lg backdrop-blur-xl" : "min-h-44 border-input/60 bg-card shadow-sm focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/20"}`}
      onSubmit={(event) => {
        void send(event)
      }}
    >
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
      <div className="flex items-center justify-between gap-2 px-3 pb-3">
        <div className="flex min-w-0 items-center gap-1">
          <button
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
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
            className="flex size-7 items-center justify-center rounded-full bg-destructive/10 text-destructive"
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
            className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
            type="submit"
            aria-label="Send message"
            disabled={!draft.trim() || busy || running}
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
    </form>
  )

  let content
  if (!loaded) {
    content = (
      <main className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
        Loading your workspace…
      </main>
    )
  } else if (view === "runners") {
    content = (
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-12">
          <div className="mb-6 flex items-center justify-between border-b border-border pb-4">
            <div>
              <h1 className="text-xl font-semibold">Your runners</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Manage your built-in tutors and model account.
              </p>
            </div>
            <button
              className="flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              disabled={busy || snapshot.runners.length >= 8}
              onClick={() => {
                setDialogRunnerId(undefined)
                setDialogName("")
                setDialogModel({ provider: "codex", model: "default" })
                runnerDialog.current?.showModal()
              }}
            >
              <Plus className="size-4" />
              Add runner
            </button>
          </div>
          <section aria-label="Model providers" className="mb-8 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Model providers</h2>
              <button
                className="rounded-md p-2 text-muted-foreground hover:bg-accent"
                aria-label="Refresh providers"
                disabled={busy}
                onClick={() => {
                  void perform(() => desktop().refreshProviders())
                }}
              >
                <RotateCcw className="size-4" />
              </button>
            </div>
            {snapshot.providers.map((provider) => {
              let description = "Connect your OpenRouter account."
              let actionLabel = "Connect account"
              if (provider.id === "codex") {
                description = "Use your ChatGPT account with Codex."
                actionLabel = "Sign in with ChatGPT"
              }
              if (provider.connected) {
                description = provider.account ?? "Connected"
                actionLabel = "Disconnect"
              }
              return (
                <div
                  key={provider.id}
                  className="rounded-lg border border-border/70 bg-card p-4 shadow-xs"
                >
                  <div className="flex items-center justify-between gap-6">
                    <div>
                      <h3 className="text-sm font-medium">{provider.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {description}
                      </p>
                    </div>
                    {provider.connecting ? (
                      <button
                        className="h-8 shrink-0 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent"
                        onClick={() => {
                          void desktop()
                            .cancelConnection(provider.id)
                            .catch((error) =>
                              setError(
                                error instanceof Error
                                  ? error.message
                                  : "Could not cancel sign-in.",
                              ),
                            )
                        }}
                      >
                        Cancel sign-in
                      </button>
                    ) : (
                      <button
                        className="h-8 shrink-0 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent"
                        disabled={busy}
                        onClick={() => {
                          void perform(async () => {
                            if (provider.connected)
                              await desktop().disconnect(provider.id)
                            else await desktop().connect(provider.id)
                          })
                        }}
                      >
                        {actionLabel}
                      </button>
                    )}
                  </div>
                  {provider.error && (
                    <p
                      className="mt-3 text-xs leading-5 text-destructive"
                      role="alert"
                    >
                      {provider.error}
                    </p>
                  )}
                </div>
              )
            })}
          </section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">Managed runners</h2>
            <span className="text-xs text-muted-foreground">
              {snapshot.runners.length} of 8
            </span>
          </div>
          <div className="space-y-3">
            {snapshot.runners.map((item) => {
              const state = snapshot.runtime.find(
                (entry) => entry.runnerId === item.id,
              )
              const status = state?.status ?? "stopped"
              const ownsTopics = snapshot.topics.some(
                (entry) => entry.runnerId === item.id,
              )
              const activeTopic = snapshot.topics.find(
                (entry) => entry.id === state?.topicId,
              )
              const provider = snapshot.providers.find(
                (entry) => entry.id === item.provider,
              )
              let modelLabel =
                provider?.models.find((model) => model.id === item.model)
                  ?.name ?? item.model
              if (item.model === "default") modelLabel = "Default model"
              if (item.model === "openrouter/auto") modelLabel = "Auto"
              return (
                <section
                  className="rounded-lg border border-border/70 bg-card p-4 shadow-xs"
                  key={item.id}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-medium">{item.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {item.provider === "codex" ? "Codex" : "OpenRouter"} ·{" "}
                        {modelLabel}
                        {item.reasoningEffort &&
                          ` · ${item.reasoningEffort} reasoning`}
                      </p>
                    </div>
                    <span
                      className={`flex items-center gap-2 text-xs ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${status === "ready" || status === "running" ? "bg-primary" : "bg-muted-foreground/40"}`}
                      />
                      {runnerStatusLabels[status]}
                    </span>
                  </div>
                  <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    {status === "running" && (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    )}
                    {state?.activity ??
                      "Starts automatically when you send a message"}
                  </p>
                  {state?.error && (
                    <p className="mt-3 text-sm text-destructive" role="alert">
                      {state.error}
                    </p>
                  )}
                  {activeTopic && status === "running" && (
                    <button
                      className="mt-3 text-sm text-primary underline underline-offset-4"
                      onClick={() => openTopic(activeTopic.id)}
                    >
                      {activeTopic.title}
                    </button>
                  )}
                  <div className="mt-4 flex items-center justify-between border-t border-border/70 pt-3">
                    <span className="text-xs text-muted-foreground">
                      Tutor Me included
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        className="rounded-md p-2 text-muted-foreground hover:bg-accent disabled:opacity-30"
                        aria-label={`Edit ${item.name}`}
                        disabled={busy || status === "running"}
                        onClick={() => {
                          setDialogRunnerId(item.id)
                          setDialogName(item.name)
                          setDialogModel(item)
                          runnerDialog.current?.showModal()
                        }}
                      >
                        <Pencil className="size-4" />
                      </button>
                      {status !== "stopped" && (
                        <button
                          className="rounded-md p-2 text-muted-foreground hover:bg-accent"
                          aria-label={`Restart ${item.name}`}
                          title="Restart runner"
                          disabled={busy}
                          onClick={() => {
                            void perform(async () => {
                              await desktop().stopRunner(item.id)
                              await desktop().startRunner(item.id)
                            })
                          }}
                        >
                          <RotateCcw className="size-4" />
                        </button>
                      )}
                      {status === "stopped" || status === "error" ? (
                        <button
                          className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent"
                          disabled={busy}
                          onClick={() => {
                            void perform(() => desktop().startRunner(item.id))
                          }}
                        >
                          <Play className="size-3.5" />
                          Start
                        </button>
                      ) : (
                        <button
                          className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent"
                          disabled={busy}
                          onClick={() => {
                            void perform(() => desktop().stopRunner(item.id))
                          }}
                        >
                          <Square className="size-3.5" />
                          Stop
                        </button>
                      )}
                      <button
                        className="rounded-md p-2 text-muted-foreground hover:bg-accent disabled:opacity-30"
                        aria-label={`Remove ${item.name}`}
                        title={
                          ownsTopics
                            ? "This runner owns saved topics"
                            : "Remove runner"
                        }
                        disabled={busy || ownsTopics}
                        onClick={() => {
                          void perform(() => desktop().removeRunner(item.id))
                        }}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                </section>
              )
            })}
          </div>
          <section className="mt-10">
            <h2 className="mb-4 border-b border-border pb-3 text-xl font-semibold">
              Appearance
            </h2>
            <div className="flex items-center justify-between gap-6 rounded-lg border border-border/70 bg-card p-4 shadow-xs">
              <div>
                <h3 className="text-sm font-medium">Theme</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose how Prune looks on your device.
                </p>
              </div>
              <select
                aria-label="Appearance"
                value={mode}
                className="h-8 w-40 rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) => {
                  const next = event.target.value
                  if (next === "system" || next === "light" || next === "dark")
                    setMode(next)
                }}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
          </section>
        </div>
      </main>
    )
  } else if (!topic) {
    content = (
      <main className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-5 py-20 sm:px-8 lg:px-0">
          <h1 className="mb-10 max-w-2xl text-3xl font-medium leading-[1.2] tracking-tight sm:text-4xl lg:text-[2.75rem]">
            Drop in slides, tutorials and past year papers to learn
          </h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Or tell Prune what you want to learn. Review the proposed plan
            before your lesson begins.
          </p>
          <div
            className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3"
            aria-label="Learning suggestions"
          >
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                disabled={busy || running}
                className="flex min-h-20 flex-col items-start justify-center gap-3 rounded-xl border border-border bg-card/40 px-5 py-4 text-left transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:min-h-32"
                onClick={() => {
                  setDraft(suggestion.prompt)
                  textarea.current?.focus()
                }}
              >
                <suggestion.icon
                  className="hidden size-5 text-primary sm:block"
                  aria-hidden="true"
                />
                <span>
                  <span className="block text-sm font-medium">
                    {suggestion.label}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {suggestion.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {composer}
        </div>
      </main>
    )
  } else {
    content = (
      <div className="flex min-h-0 flex-1">
        <main className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
          <button
            className="absolute right-4 top-4 rounded-md p-2 text-muted-foreground hover:bg-accent"
            aria-label="Open workspace in Finder"
            title="Open workspace in Finder"
            onClick={() =>
              void perform(() => desktop().openWorkspace(topic.id))
            }
          >
            <FolderOpen className="size-4" />
          </button>
          <article className="mx-auto w-full max-w-[850px] px-6 pb-24 pt-12 sm:px-12 lg:pt-16">
            <div className="mx-auto max-w-[700px]">
              <h1 className="min-w-0 break-words text-3xl font-semibold leading-tight tracking-tight sm:text-[2.5rem]">
                {topic.title}
              </h1>
              {topic.materials.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {topic.materials.map((material) => (
                    <span
                      key={material.id}
                      className="flex max-w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground"
                    >
                      <FileText className="size-4 shrink-0" />
                      <span className="truncate">{material.name}</span>
                    </span>
                  ))}
                </div>
              )}
              {topic.learning.outline.length > 0 && (
                <nav
                  className="mt-9 rounded-lg border border-border bg-card/40 px-5 py-5"
                  aria-label="Learning plan"
                >
                  <h2 className="text-base font-semibold">Table of contents</h2>
                  <ol className="mt-3 space-y-2">
                    {topic.learning.outline.map((section, index) => (
                      <li
                        key={`${index}-${section}`}
                        className={`text-sm leading-snug ${section === topic.learning.currentSection ? "font-medium text-foreground" : "text-muted-foreground"}`}
                      >
                        {section}
                      </li>
                    ))}
                  </ol>
                </nav>
              )}
              <div className="study-document mt-9">
                <StudyMarkdown
                  text={topic.learning.notes.replace(/^# .+\n+/, "")}
                />
              </div>
              {!topic.planConfirmed && topic.learning.outline.length > 0 && (
                <div className="mt-9">
                  <p className="mb-3 text-sm text-muted-foreground">
                    Review the scope and order. You can ask for changes in chat.
                  </p>
                  <button
                    className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
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
              )}
            </div>
          </article>
        </main>
        <aside
          className="flex w-[22rem] shrink-0 flex-col border-l border-border bg-background xl:w-[25rem]"
          aria-label="Tutor chat"
        >
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
            <h2 className="text-sm font-semibold">Chat</h2>
            <span className="ml-auto text-xs text-muted-foreground">
              {topicRunning ? "Working" : "Ready to learn"}
            </span>
          </div>
          <div className="relative min-h-0 flex-1">
            <div
              ref={thread}
              className="absolute inset-0 overflow-y-auto px-4 pb-40 pt-4"
              role="log"
              aria-label="Conversation"
            >
              {topic.messages.length === 0 && (
                <p className="flex h-full items-center justify-center px-5 text-center text-sm leading-6 text-muted-foreground">
                  Tell Prune what you want to learn, or add slides and tutorials
                  below.
                </p>
              )}
              {topic.messages.map((message) => {
                if (message.role === "user")
                  return (
                    <div
                      key={message.id}
                      className="flex flex-col items-end py-3"
                    >
                      <div className="max-w-[90%] rounded-2xl rounded-br-md bg-secondary px-4 py-3 text-sm leading-relaxed text-secondary-foreground">
                        <StudyMarkdown text={message.content} />
                      </div>
                    </div>
                  )
                return (
                  <div key={message.id} className="py-4">
                    <div className="mb-3 text-xs font-medium text-muted-foreground">
                      Prune
                    </div>
                    <StudyMarkdown text={message.content} />
                  </div>
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
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-4 px-4">
              <div className="pointer-events-auto">{composer}</div>
            </div>
          </div>
        </aside>
      </div>
    )
  }

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <aside
        className="flex w-64 shrink-0 flex-col border-r border-border bg-sidebar lg:w-72"
        aria-label="Workspace navigation"
      >
        <div className="flex h-20 shrink-0 items-center px-5">
          <button
            onClick={() => openTopic()}
            className="flex items-center gap-3 rounded-md text-left text-lg font-semibold tracking-tight"
          >
            <span
              className="flex size-8 items-center justify-center rounded-lg border border-primary/35 bg-primary/10 font-serif text-xl text-primary"
              aria-hidden="true"
            >
              P
            </span>
            Prune
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5">
          <button
            className="mb-5 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background text-sm font-medium transition-colors hover:bg-accent"
            onClick={() => openTopic()}
          >
            <span aria-hidden="true" className="text-lg leading-none">
              +
            </span>
            New topic
          </button>
          <p className="px-3 pb-2 text-xs font-medium text-muted-foreground">
            Your topics
          </p>
          <nav className="space-y-1" aria-label="Your topics">
            {snapshot.topics.map((item) => (
              <button
                key={item.id}
                className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm leading-snug transition-colors ${view === "learn" && item.id === topicId ? "bg-sidebar-accent font-medium text-sidebar-foreground ring-1 ring-sidebar-border" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"}`}
                aria-current={
                  view === "learn" && item.id === topicId ? "page" : undefined
                }
                onClick={() => openTopic(item.id)}
              >
                <span className="line-clamp-2">{item.title}</span>
                {snapshot.runtime.some(
                  (state) =>
                    state.topicId === item.id && state.status === "running",
                ) && (
                  <LoaderCircle
                    className="size-3.5 shrink-0 animate-spin"
                    aria-label="Runner working"
                  />
                )}
              </button>
            ))}
          </nav>
        </div>
        <div className="px-3 pb-3">
          <button
            className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm ${view === "runners" ? "bg-sidebar-accent font-medium text-sidebar-foreground ring-1 ring-sidebar-border" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"}`}
            onClick={() => {
              setView("runners")
              setError(null)
            }}
          >
            <Cpu className="size-4" />
            Runners
          </button>
        </div>
        <div className="flex h-16 shrink-0 items-center gap-3 border-t border-border px-4">
          <button
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Model accounts"
            title="Model accounts"
            onClick={() => setView("runners")}
          >
            <UserCircle className="size-5" />
          </button>
          <button
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Settings"
            onClick={() => setView("runners")}
          >
            <Settings className="size-5" />
          </button>
        </div>
      </aside>
      <div className="relative flex min-w-0 flex-1 flex-col">
        {error && (
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
        )}
        {content}
      </div>
      <dialog
        ref={runnerDialog}
        className="m-auto w-[min(440px,calc(100vw-48px))] rounded-xl border border-border bg-popover p-6 text-popover-foreground shadow-xl backdrop:bg-black/50"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = event.currentTarget
            void perform(async () => {
              const input = { name: dialogName, ...dialogModel }
              if (dialogRunnerId)
                await desktop().updateRunner(dialogRunnerId, input)
              else await desktop().addRunner(input)
              runnerDialog.current?.close()
              form.reset()
            })
          }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">
              {dialogRunnerId ? "Edit runner" : "Add a runner"}
            </h2>
            <button
              className="rounded-md p-1 text-muted-foreground hover:bg-accent"
              type="button"
              aria-label="Close add runner"
              onClick={() => runnerDialog.current?.close()}
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="mb-5 mt-2 text-sm text-muted-foreground">
            Each runner follows the built-in Tutor Me skill.
          </p>
          <label
            className="mb-2 block text-sm font-medium"
            htmlFor="runner-name"
          >
            Name
          </label>
          <input
            className="mb-4 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            id="runner-name"
            name="name"
            value={dialogName}
            onChange={(event) => setDialogName(event.target.value)}
            placeholder="e.g. Mathematics tutor"
            maxLength={60}
            required
          />
          <ProviderModelFields
            value={dialogModel}
            onChange={setDialogModel}
            lockProvider={
              !!dialogRunnerId &&
              snapshot.topics.some((topic) => topic.runnerId === dialogRunnerId)
            }
          />
          {error && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <button
              className="h-8 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent"
              type="button"
              onClick={() => runnerDialog.current?.close()}
            >
              Cancel
            </button>
            <button
              className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
              type="submit"
              disabled={busy}
            >
              {dialogSaveLabel}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  )
}
