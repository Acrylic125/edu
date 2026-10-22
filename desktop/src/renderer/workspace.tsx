import { messageText } from "../shared/message-text"
import { useEffect, useRef, useState, type ComponentProps } from "react"
import {
  ArrowUp,
  Archive,
  ArchiveRestore,
  AtSign,
  Check,
  ChevronRight,
  Copy,
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
  transitionWorkspace,
} from "@edu/ui/workspace"
import { DesktopSettings, ProviderConnectionSetup } from "./settings/settings"
import appIcon from "./assets/app-icon.png"
import { useWorkspace, desktop, desktopErrorMessage } from "./store"
import { useChatTabs } from "./chat-tabs"
import { useChatScroll } from "./chat-scroll"
import { useTopicViews } from "./topic-views"
import { WorkspaceLoading, WorkspaceLoadingSidebar } from "./workspace-loading"
import { StudyMarkdown } from "./markdown"
import { MediaPreview } from "./media-preview"
import { TopicDirectory } from "./topic-directory"
import { ProviderModelPicker } from "./provider-model-picker"
import { TopicMentionInput } from "./topic-mention-input"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@edu/ui/context-menu"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@edu/ui/collapsible"
import { Badge } from "@edu/ui/badge"
import { z } from "zod"
import { providerDefaultModels, PastedImageSchema, type MaterialDraftSchema, type RunnerSchema, type Snapshot } from "../shared/contracts"
import { mostRecentTopic } from "../shared/recent-topic"
import { topicMention } from "../shared/topic-mentions"
import { parseTopicDirectory } from "../shared/topic-directory"
import { materialDisplayName, topicSourceMaterials } from "../shared/material-links"

function ConfirmPlanButton(props: Pick<ComponentProps<"button">, "disabled" | "onClick">) {
  return (
    <button
      type="button"
      className="flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
      {...props}
    >
      <Check className="size-4" />
      Confirm plan & begin
    </button>
  )
}

export function App() {
  const { snapshot, loaded, providerSetupComplete, error, setError } = useWorkspace()
  const [setupProvider, setSetupProvider] = useState<Snapshot["providers"][number]["id"]>()
  const [view, setView] = useState<"learn" | "settings">("learn")
  const { activeId: topicId, select: selectTopic } = useTopicViews()
  const { activeId: chatId, openIds, select: selectChat, close: closeChat } = useChatTabs()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [imageDrafts, setImageDrafts] = useState<Record<string, (z.infer<typeof MaterialDraftSchema> & { previewUrl: string })[]>>({})
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
  const [fileSelection, setFileSelection] = useState<string>()
  const [fileSelectionError, setFileSelectionError] = useState<{ key: string; message: string }>()
  const fileSelectionId = useRef<symbol | undefined>(undefined)
  const [submitting, setSubmitting] = useState<string>()
  const responding = useRef(new Set<string>())
  const draftValues = useRef(drafts)
  draftValues.current = drafts
  const [draggingOver, setDraggingOver] = useState<string>()
  const thread = useChatScroll(chatId)
  const topic = snapshot.topics.find((item) => item.id === topicId)
  const chat = snapshot.chats.find((item) => item.id === chatId)
  const messageCheckLabels = new Map<string, string>()
  let checkLabel = "Check your understanding"
  for (const message of chat?.messages ?? []) {
    if (message.role === "user" && message.topicIds.length > 0) {
      const hasTest = snapshot.topics.some((item) => message.topicIds.includes(item.id) && item.state?.type === "test")
      checkLabel = hasTest ? "TEST" : "Check your understanding"
    }
    messageCheckLabels.set(message.id, checkLabel)
  }
  const taggedTopicIds = new Set(chat?.messages.flatMap((message) => message.topicIds) ?? [])
  const draftPlans = snapshot.topics.filter((candidate) => taggedTopicIds.has(candidate.id) && !candidate.archived && !candidate.planConfirmed && candidate.learning.outline.length > 0)
  const awaitingPlanConfirmation = chat?.phase === "awaiting_plan_confirmation" && draftPlans.length > 0
  const labelMaterials = [...snapshot.topics, ...snapshot.chats].flatMap((item) => item.materials)
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
    newRunnerConfig ?? { provider: "codex" as const, model: providerDefaultModels.codex }
  const chatRunnerConfig = snapshot.runners.find(
    (item) => item.id === (chat?.runnerId ?? newRunner),
  )
  let chatModel = newModel
  if (chat && chatRunnerConfig) chatModel = chatRunnerConfig
  const runtime = snapshot.runtime.find(
    (item) => item.chatId === chat?.id && item.chatId !== undefined,
  )
  const chatRunnerBusy = runtime?.status === "running"
  const chatRunning = chatRunnerBusy && !!chat && runtime.chatId === chat.id
  const chatError = chat && runtime?.chatId === chat.id ? runtime.error : undefined
  const newModelConnected = snapshot.providers.some(
    (provider) => provider.id === newModel.provider && provider.connected,
  )
  const chatModelConnected = snapshot.providers.some(
    (provider) => provider.id === chatModel.provider && provider.connected,
  )


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
        const topics = useWorkspace.getState().snapshot.topics
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
    if (view === "learn" && id === topicId) {
      setError(null)
      return
    }

    transitionWorkspace(() => {
      selectTopic(id)
      setView("learn")
      setError(null)
    })
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
    setImageDrafts((current) => ({
      ...current,
      "new-chat": [],
      [id]: current["new-chat"] ?? [],
    }))
    setDrafts((current) => ({
      ...current,
      "new-chat": "",
      [id]: current["new-chat"] ?? "",
    }))
    return id
  }

  async function sendChat() {
    let content = drafts[chatKey] ?? ""
    if (chatRunnerBusy || busy || fileSelection === chatKey || !chatModelConnected) return
    const pendingImages = imageDrafts[chatKey] ?? []
    if (!content.trim()) {
      const materials = [...(chat?.materials ?? []), ...pendingImages]
      if (materials.length === 0) return
      content = `Help me understand the attached materials: ${materials.map((material) => material.name).join(", ")}.`
    }
    let sentId = chatKey
    const submittedDraft = drafts[chatKey] ?? ""
    setSubmitting(chatKey)
    try {
      const success = await perform(async () => {
        sentId = await ensureChat()
        if (pendingImages.length > 0) {
          await desktop().importMaterials({ kind: "chat", id: sentId }, pendingImages.map((image) => image.id))
          setImageDrafts((current) => ({ ...current, [chatKey]: [], [sentId]: [] }))
        }
        await desktop().send({ chatId: sentId, content, openedTopicId: topic?.id })
      })
      // Typing stays available during submission; never erase edits made while IPC is pending.
      if (success && draftValues.current[sentId] === submittedDraft) replaceDraft(sentId, "")
    } finally {
      setSubmitting(undefined)
    }
  }

  async function respondToQuestion(messageId: string, option: string) {
    const message = chat?.messages.at(-1)
    if (!chat || message?.id !== messageId || !message.responseQuestion?.options.includes(option)) return
    if (chatRunnerBusy || busy || !chatModelConnected || responding.current.has(messageId)) return
    responding.current.add(messageId)
    setSubmitting(chat.id)
    try {
      await perform(() => desktop().send({ chatId: chat.id, content: option, openedTopicId: topic?.id }))
    } finally {
      responding.current.delete(messageId)
      setSubmitting(undefined)
    }
  }

  async function confirmPlan(target: Snapshot["topics"][number]) {
    if (target.planConfirmed || !target.learning.outline.length || chatRunnerBusy || busy || !chatModelConnected || responding.current.has(target.id)) return
    responding.current.add(target.id)
    try {
      await perform(async () => {
        const id = await ensureChat()
        await desktop().send({
          chatId: id,
          content: `${topicMention(target.id, target.title)} I confirm this learning plan. Begin at the suggested starting point.`,
          confirmTopicId: target.id,
          openedTopicId: target.id,
        })
      })
    } finally {
      responding.current.delete(target.id)
    }
  }

  async function startTopic() {
    let content = drafts["new-topic"] ?? ""
    if (busy || fileSelection === "new-topic" || !newModelConnected) return
    if (!content.trim()) {
      if (topicMaterials.length === 0) return
      content = `Help me work with the attached materials: ${topicMaterials.map((material) => material.name).join(", ")}.`
    }
    openTopic()
    let createdChat: string | undefined
    let submittedMessage = ""
    setSubmitting("new-topic")
    const success = await perform(async () => {
      const runner = await newRunnerId()
      const chatId = await desktop().createChat({ runnerId: runner, scratchpadRequested: true })
      createdChat = chatId
      let materialIds: string[] = []
      if (topicMaterials.length > 0) {
        await desktop().importMaterials({ kind: "chat", id: chatId }, topicMaterials.map((material) => material.id))
        const imported = (await desktop().snapshot()).chats.find((item) => item.id === chatId)
        materialIds = imported?.materials.map((material) => material.id) ?? []
        setTopicMaterials([])
        setImageDrafts((current) => ({ ...current, "new-topic": [] }))
      }
      const message = content
      submittedMessage = message
      transitionWorkspace(() => {
        selectTopic(undefined)
        selectChat(chatId)
      })
      // The new-topic composer is replaced by the topic, so a failed send keeps the request in its chat.
      replaceDraft("new-topic", "")
      replaceDraft(chatId, message)
      await desktop().send({ chatId, content: message, materialIds })
    })
    setSubmitting(undefined)
    if (success && createdChat && draftValues.current[createdChat] === submittedMessage) replaceDraft(createdChat, "")
  }

  async function attachMaterials(mode: "topic" | "chat") {
    if (fileSelectionId.current || busy) return
    const key = mode === "topic" ? "new-topic" : chatKey
    const selectionId = Symbol()
    const draftIds = mode === "topic" ? topicMaterials.map((material) => material.id) : []
    fileSelectionId.current = selectionId
    setFileSelection(key)
    setFileSelectionError(undefined)
    setError(null)
    try {
      const materials = await desktop().selectMaterials(draftIds)
      if (fileSelectionId.current !== selectionId) {
        // A canceled picker can still finish later; its files must not attach to another draft.
        await desktop().discardMaterials(materials.filter((material) => !draftIds.includes(material.id)).map((material) => material.id))
        return
      }
      if (mode === "topic") setTopicMaterials(materials)
      else if (materials.length > 0) {
        fileSelectionId.current = undefined
        setFileSelection(undefined)
        await perform(async () => {
          const id = await ensureChat()
          await desktop().importMaterials({ kind: "chat", id }, materials.map((material) => material.id))
        })
      }
    } catch (failure) {
      if (fileSelectionId.current === selectionId) {
        setFileSelectionError({ key, message: failure instanceof Error ? desktopErrorMessage(failure) : "Could not select files. Try again." })
      }
    } finally {
      if (fileSelectionId.current === selectionId) {
        fileSelectionId.current = undefined
        setFileSelection(undefined)
      }
    }
  }

  function composer(mode: "topic" | "chat") {
    const key = mode === "topic" ? "new-topic" : chatKey
    const existing = mode === "chat" ? chat : undefined
    const pendingImages = imageDrafts[key] ?? []
    const materials = mode === "topic" ? topicMaterials : [...(existing?.materials ?? []), ...pendingImages]
    const draft = drafts[key] ?? ""
    let runnerBusy = chatRunnerBusy
    let model = chatModel
    let placeholder = "Ask anything, or type @ to tag a scratchpad…"
    let submit = sendChat
    const attach = () => attachMaterials(mode)
    if (mode === "topic") {
      runnerBusy = false
      model = newModel
      placeholder = "What would you like to learn?"
      submit = startTopic
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
    async function pasteImages(files: File[]) {
      await perform(async () => {
        if (files.length > 12) throw new Error("Add up to 12 materials at a time.")
        if (files.some((file) => file.size > 8 * 1024 * 1024))
          throw new Error("Use images smaller than 8 MB.")
        const images = await Promise.all(files.map(async (file) => {
          const previewUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => {
              if (typeof reader.result === "string") resolve(reader.result)
              else reject(new Error("Could not preview this image."))
            }
            reader.onerror = () => reject(new Error("Could not read this image. Try pasting it again."))
            reader.readAsDataURL(file)
          })
          return { mimeType: file.type, data: new Uint8Array(await file.arrayBuffer()), previewUrl }
        }))
        const validated = PastedImageSchema.array().parse(images)
        let draftIds = pendingImages.map((image) => image.id)
        if (mode === "topic") draftIds = topicMaterials.map((material) => material.id)
        const materials = await desktop().pasteMaterials(validated, draftIds)
        const added = materials.slice(draftIds.length).map((material, index) => ({
          ...material,
          previewUrl: images[index].previewUrl,
        }))
        setImageDrafts((current) => ({ ...current, [key]: [...(current[key] ?? []), ...added] }))
        if (mode === "topic") setTopicMaterials(materials)
      })
    }
    const provider = snapshot.providers.find((provider) => provider.id === model.provider)
    const providerDisconnected = !provider?.connected && !provider?.loading
    const submittingComposer = submitting === key
    let submitLabel = "Send message"
    if (submittingComposer) {
      submitLabel = "Sending message"
      if (mode === "topic") submitLabel = "Creating scratchpad"
    }
    const attachmentBusy = busy || fileSelection !== undefined || (mode === "topic" && runnerBusy)
    return (
      <ChatComposerLayout
        aria-label={mode === "topic" ? "New scratchpad composer" : "Chat composer"}
        newTopicMode={mode === "topic"}
        onPasteCapture={(event) => {
          const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"))
          if (images.length === 0) return
          event.preventDefault()
          event.stopPropagation()
          if (!attachmentBusy) void pasteImages(images)
        }}
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
            {fileSelection === key && (
              <div role="status" className="m-3 flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
                <span>Waiting for file selection. Choose files in the file picker, or cancel and try again if it hasn’t appeared.</span>
                <button type="button" className="shrink-0 font-medium underline underline-offset-2" aria-label="Cancel file selection" onClick={() => {
                  fileSelectionId.current = undefined
                  setFileSelection(undefined)
                  setFileSelectionError({ key, message: "File selection canceled. Your draft is unchanged." })
                }}>Cancel</button>
              </div>
            )}
            {fileSelectionError?.key === key && (
              <div role="alert" className="m-3 flex items-center justify-between gap-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <span>{fileSelectionError.message}</span>
                <button type="button" className="shrink-0 font-medium underline underline-offset-2" disabled={attachmentBusy} aria-label="Retry attaching files" onClick={() => { void attach() }}>Retry</button>
              </div>
            )}
            {providerDisconnected && (
              <div role="alert" className="m-3 flex items-center justify-between gap-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <span>{provider?.name ?? model.provider} is disconnected. Connect it or choose a connected provider before sending.</span>
                <button type="button" className="shrink-0 font-medium underline underline-offset-2" onClick={() => {
                  setSetupProvider(model.provider)
                  transitionWorkspace(() => setView("settings"))
                }}>Connect provider</button>
              </div>
            )}
            {pendingImages.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 pt-3" aria-label="Attached images">
                {pendingImages.map((image) => (
                  <div key={image.id} className="relative size-20 overflow-hidden rounded-lg border border-border bg-muted">
                    <MediaPreview label={image.name} preview={<img src={image.previewUrl} alt={image.name} />}>
                      {(open) => (
                        <button
                          type="button"
                          aria-label={`Preview ${image.name}`}
                          aria-haspopup="dialog"
                          className="size-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                          onClick={open}
                        >
                          <img src={image.previewUrl} alt={`Attached image ${image.name}`} className="size-full object-contain" />
                        </button>
                      )}
                    </MediaPreview>
                    <button
                      type="button"
                      aria-label={`Remove ${image.name}`}
                      title="Remove image"
                      disabled={busy}
                      className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-background/95 text-foreground shadow-sm hover:bg-accent disabled:opacity-50"
                      onClick={() => {
                        void perform(async () => {
                          await desktop().discardMaterials([image.id])
                          setImageDrafts((current) => ({ ...current, [key]: (current[key] ?? []).filter((item) => item.id !== image.id) }))
                          if (mode === "topic") setTopicMaterials((current) => current.filter((item) => item.id !== image.id))
                        })
                      }}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {mode === "topic" && topicMaterials.some((material) => !pendingImages.some((image) => image.id === material.id)) && (
              <div className="flex flex-wrap gap-1.5 px-4 pt-3">
                {topicMaterials.filter((material) => !pendingImages.some((image) => image.id === material.id)).map((material) => (
                  <span
                    key={material.id}
                    title={material.name}
                    className="flex h-6 max-w-48 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground"
                  >
                    <FileText className="size-3.5 shrink-0" />
                    <span className="truncate">{materialDisplayName(material, [...labelMaterials, ...topicMaterials])}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${material.name}`}
                      disabled={busy}
                      onClick={() => {
                        void perform(async () => {
                          await desktop().discardMaterials([material.id])
                          setTopicMaterials((current) => current.filter((item) => item.id !== material.id))
                        })
                      }}
                    >
                      <X className="size-3.5" />
                    </button>
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
                  transitionWorkspace(() => setView("settings"))
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
                  void perform(() => desktop().stopRunner(existing.runnerId, existing.id))
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
                disabled={(!draft.trim() && materials.length === 0) || busy || fileSelection === key || runnerBusy || !provider?.connected}
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
  const recentTopic = mostRecentTopic(snapshot)
  const newTopicContent = (
    <NewTopicView>
      <LearningSuggestions
        testTopic={recentTopic && { title: recentTopic.title, mention: topicMention(recentTopic.id, recentTopic.title) }}
        disabled={busy}
        onSelect={(prompt) => {
          openTopic()
          replaceDraft("new-topic", prompt)
        }}
      />
      {composer("topic")}
    </NewTopicView>
  )
  const chatPane = (
    <ChatSessions {...sessionProps}>
      <ChatPanel composer={composer("chat")}>
        {!chat || (chat.messages.length === 0 && !chatRunning && !chatError) ? (
          <ChatEmptyState
            title="Start a chat"
            description={topic
              ? "The open scratchpad and its sources are included. Type @ to bring another scratchpad into this chat."
              : "Ask anything. Type @ to bring a scratchpad and its sources into this chat."}
            onPrompt={(prompt) => replaceDraft(chatKey, prompt)}
          />
        ) : (
          <ChatConversation key={chatId} ref={thread} className="px-4">
            {chat.messages.map((message) => (
              <ChatMessage key={message.id} role={message.role} copyText={messageText(message)} onCopy={window.prune?.copyText} durationMs={message.durationMs}>
                {message.role === "user" && message.materialIds?.length ? (
                  <div className="mb-2 flex flex-wrap gap-1" aria-label="Attached files">
                    {(message.materialIds ?? []).flatMap((id) => {
                      const material = chatMaterials.find((material) => material.id === id)
                      return material ? [material] : []
                    }).map((material) => {
                      if (material.kind !== "image") {
                        return (
                          <button
                            key={material.id}
                            type="button"
                            title={material.name}
                            className="inline-flex h-6 max-w-48 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted"
                            onClick={() => { void perform(() => desktop().openMaterial(material.id)) }}
                          >
                            <FileText className="size-3 shrink-0" />
                            <span className="truncate">{materialDisplayName(material, labelMaterials)}</span>
                          </button>
                        )
                      }
                      return (
                        <MediaPreview
                          key={material.id}
                          label={material.name}
                          preview={<img src={`prune-source://${material.id}/1`} alt={material.name} />}
                        >
                          {(open) => (
                            <button
                              type="button"
                              aria-label={`Preview ${material.name}`}
                              aria-haspopup="dialog"
                              className="max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                              onClick={open}
                            >
                              <img src={`prune-source://${material.id}/1`} alt={material.name} className="max-h-48 max-w-full object-contain" />
                            </button>
                          )}
                        </MediaPreview>
                      )
                    })}
                  </div>
                ) : null}
                <StudyMarkdown
                  text={message.content}
                  checkLabel={messageCheckLabels.get(message.id)}
                  showSourcePreviews={message.role === "assistant"}
                  topics={snapshot.topics}
                  onOpenTopic={openTopic}
                  materials={chatMaterials}
                  labelMaterials={labelMaterials}
                  onOpenMaterial={(id) => { void perform(() => desktop().openMaterial(id)) }}
                />
                {message.role === "assistant" && message.id === chat.messages.at(-1)?.id && awaitingPlanConfirmation && draftPlans.map((plan) => (
                  <div key={plan.id} className="mt-4" role="group" aria-label={`Confirm learning plan for ${plan.title}`}>
                    <p className="mb-3 text-sm text-muted-foreground">Review the plan for {plan.title}. You can ask for changes in chat.</p>
                    <ConfirmPlanButton disabled={busy || chatRunnerBusy || !chatModelConnected} onClick={() => { void confirmPlan(plan) }} />
                  </div>
                ))}
                {message.role === "assistant" && message.responseQuestion && !(message.id === chat.messages.at(-1)?.id && awaitingPlanConfirmation) && (
                  <fieldset
                    className="mt-4 flex min-w-0 flex-col gap-2"
                    disabled={message.id !== chat.messages.at(-1)?.id || chatRunnerBusy || busy || !chatModelConnected || submitting === chat.id}
                  >
                    <legend className="mb-2 text-sm font-medium">{message.responseQuestion.prompt}</legend>
                    {message.responseQuestion.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className="rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                        onClick={() => { void respondToQuestion(message.id, option) }}
                      >
                        {option}
                      </button>
                    ))}
                  </fieldset>
                )}
              </ChatMessage>
            ))}
            {chatRunning && runtime.reply && (
              <ChatMessage role="assistant">
                <StudyMarkdown
                  text={runtime.reply}
                  checkLabel={checkLabel}
                  showSourcePreviews
                  topics={snapshot.topics}
                  onOpenTopic={openTopic}
                  materials={chatMaterials}
                  labelMaterials={labelMaterials}
                  onOpenMaterial={(id) => { void perform(() => desktop().openMaterial(id)) }}
                />
              </ChatMessage>
            )}
            {chatRunning && !runtime.reply && (
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
      <WorkspacePanes body={<WorkspaceLoading />} />
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
    const documentMaterials = topicSourceMaterials(topic, snapshot.chats)
    const topicState = topic.state?.type === "topic" ? topic.state : undefined
    const thread = topicState?.threadTutors.find((thread) => thread.id === chat?.id)
    const currentPart = topicState?.content.find((part) => thread?.progress[part.id]?.status === "active")
    const notes = parseTopicDirectory(
      topic.learning.notes.replace(/^# .+\n+/, ""),
    )
    content = (
      <WorkspacePanes
        chatLabel="Tutor chat"
        status={chatRunning ? "Working" : "Ready to learn"}
        documentActions={
          <div className="absolute inset-x-4 top-4 z-10 flex items-center justify-between gap-2">
            <Badge variant={topic.state?.type ?? "topic"}>
              {{ topic: "Topic", test: "Test", generic: "Generic" }[topic.state?.type ?? "topic"]}
            </Badge>
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
                    <button
                      type="button"
                      key={material.id}
                      className="flex h-6 max-w-full cursor-pointer items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      title={`Open ${material.name}`}
                      onClick={() =>
                        void perform(() => desktop().openMaterial(material.id))
                      }
                    >
                      <FileText className="size-3 shrink-0" />
                      <span className="truncate">{materialDisplayName(material, labelMaterials)}</span>
                    </button>
                  ))
                : null
            }
            actions={
              topic.state?.type === "topic" && !topic.planConfirmed &&
              topic.learning.outline.length > 0 && (
                <div className="mt-9" role="group" aria-label="Topic plan confirmation">
                  <p className="mb-3 text-sm text-muted-foreground">
                    Review the scope and order. You can ask for changes in chat.
                  </p>
                  <ConfirmPlanButton
                    disabled={busy || chatRunnerBusy || !chatModelConnected}
                    onClick={() => { void confirmPlan(topic) }}
                  />
                </div>
              )
            }
          >
            <StudyMarkdown text={notes.before} topics={snapshot.topics} onOpenTopic={openTopic} materials={documentMaterials} labelMaterials={labelMaterials} onOpenMaterial={(id) => { void perform(() => desktop().openMaterial(id)) }} />
            {notes.directory && (
              <TopicDirectory
                heading={notes.directory.heading}
                items={notes.directory.items}
                markdown={[notes.before, notes.after]}
                topics={snapshot.topics}
                onOpenTopic={openTopic}
                currentSection={currentPart?.name ?? ""}
                materials={documentMaterials}
                labelMaterials={labelMaterials}
                onOpenMaterial={(id) => { void perform(() => desktop().openMaterial(id)) }}
              />
            )}
            {notes.after.trim() && <StudyMarkdown text={notes.after} topics={snapshot.topics} onOpenTopic={openTopic} materials={documentMaterials} labelMaterials={labelMaterials} onOpenMaterial={(id) => { void perform(() => desktop().openMaterial(id)) }} />}
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
          transitionWorkspace(() => setView("learn"))
          setSetupProvider(undefined)
        }}
      />
    )
  }

  return (
    <>
      <WorkspaceFrame
        title={loaded ? topic?.title ?? "New scratchpad" : "Loading workspace…"}
        workspaceId={topic?.id ?? "new"}
        appName="EdU"
        navigationName="scratchpads"
        nativeTitlebar={navigator.userAgent.includes("Macintosh")}
        hasChat={loaded && view === "learn" && hasChat}
        sidebar={
          !loaded ? <WorkspaceLoadingSidebar /> :
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
            onCopyTopicId={(item) => {
              void perform(() => desktop().copyText(item.id))
            }}
            busy={busy}
            onOpenSettings={() => {
              setSetupProvider(undefined)
              transitionWorkspace(() => setView("settings"))
              setError(null)
            }}
          />
        }
        banner={
          <>
          {busy && (
            <div role="status" className="flex items-center gap-2 border-b border-border px-5 py-3 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              {submitting ? "Sending your request…" : "Finishing your action…"}
            </div>
          )}
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
          </>
        }
      >
        {content}
      </WorkspaceFrame>
    </>
  )
}

export function DesktopSidebar({
  snapshot,
  topicId,
  view,
  onOpenTopic,
  onOpenSettings,
  onTagTopic,
  onArchiveTopic,
  onCopyTopicId,
  busy,
}: {
  snapshot: Snapshot
  topicId?: string
  view: "learn" | "settings"
  onOpenTopic: (id?: string) => void
  onOpenSettings: () => void
  onTagTopic: (topic: Snapshot["topics"][number]) => void
  onArchiveTopic: (topic: Snapshot["topics"][number]) => void
  onCopyTopicId: (topic: Snapshot["topics"][number]) => void
  busy: boolean
}) {
  const { closeNavigation, revealChat } = useWorkspaceLayout()
  const tagging = useRef(false)
  const activeTopics = snapshot.topics.filter((item) => !item.archived)
  const archivedTopics = snapshot.topics.filter((item) => item.archived)
  const selectedArchivedTopicId = archivedTopics.find((item) => item.id === topicId)?.id
  const [archiveDisclosure, setArchiveDisclosure] = useState({
    selectedTopicId: selectedArchivedTopicId,
    open: selectedArchivedTopicId !== undefined,
  })

  if (archiveDisclosure.selectedTopicId !== selectedArchivedTopicId) {
    setArchiveDisclosure({
      selectedTopicId: selectedArchivedTopicId,
      open: archiveDisclosure.open || selectedArchivedTopicId !== undefined,
    })
  }
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
              scratchpadType={item.state?.type ?? "topic"}
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
            {item.archived ? "Unarchive scratchpad" : "Archive scratchpad"}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onCopyTopicId(item)}>
            <Copy aria-hidden="true" />
            Copy Scratchpad ID
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
        New scratchpad
      </button>
      <TopicNavigation label="Your scratchpads" empty={activeTopics.length === 0}>
        {activeTopics.map(topicItem)}
      </TopicNavigation>
      {archivedTopics.length > 0 && (
        <Collapsible className="mt-6" open={archiveDisclosure.open} onOpenChange={(open) => setArchiveDisclosure({ selectedTopicId: selectedArchivedTopicId, open })}>
          <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex min-w-0 items-center gap-2">
              Archived
              <Badge variant="secondary" className="min-w-5 px-1.5 tabular-nums">{archivedTopics.length}</Badge>
            </span>
            <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <nav className="space-y-1.5" aria-label="Archived">
              {archivedTopics.map(topicItem)}
            </nav>
          </CollapsibleContent>
        </Collapsible>
      )}
    </WorkspaceSidebar>
  )
}
