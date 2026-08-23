# Candidate C — Run Frame Log + Fold

**Organizing structure: an append-only, ordered *run frame log* on the wire, folded by a pure client reducer into a typed conversation. The Durable Object is the run state machine and the only writer of message identity.**

One structure carries all five fixes. Streaming is a frame. A stop is a terminal frame. A confirmation is a typed part inside a frame. History is the same frames, already committed, replayed by a server component. There is no second mechanism anywhere.

---

## Problem

Five defects, treated as one day-one design:

1. `ChatDurableObject` awaits `handleChat` and sends one terminal `response`. `callLlm` is invoke-only. Nothing streams. Requirement: flush buffered generated text every 8 words, or when the message part completes.
2. Assistant text renders as `whitespace-pre-wrap`. `react-markdown` / `remark-math` / `rehype-katex` / `katex` are installed and unused. This is an education app; math must render.
3. `page.tsx` mounts a client component seeded with `initialChatUiState` (empty). Every reload looks like a brand new conversation even though `topic_message` holds the history. Requirement: load *all* messages for the current topic in server components behind Suspense.
4. `composerDisabled = connecting || busy` disables the textarea. Requirement: the textarea is never disabled; submit is disabled while connecting; while a run is in flight the send button becomes Stop, and Stop actually aborts the run.
5. The agent infers intent then immediately acts. `handleNoTopic` auto-creates a topic. `executeUpdateTopic` calls `applyUpdateDirect` whenever the message is non-empty, skipping its own confirmation path. `parseJsonFromLlm` takes fallbacks that fabricate a title, summary, or question when the model returns junk. Requirement: act only on explicit commands; when inferring, confirm first.

Three of these five are the same bug: **the system commits to a result before it has the right to.** It commits to a whole message before the text exists (1), it commits to a topic before the user agreed (5), and the client commits to an empty conversation before the server has spoken (3). The design below makes commitment explicit and staged.

---

## Usage (caller's view)

### Rendering the chat (server component, `page.tsx`)

```tsx
// web/app/(app)/page.tsx
import { Suspense } from "react"

import { ChatBoot } from "@/components/chat/chat-boot"
import { ChatSkeleton } from "@/components/chat/chat-skeleton"

export default function Home() {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ChatBoot />
    </Suspense>
  )
}
```

```tsx
// web/components/chat/chat-boot.tsx  (async server component)
import { ChatWorkspace } from "@/components/chat/chat-workspace"
import { fetchChatHistory } from "@/lib/chat/history"
import { conversationFromHistory } from "@/lib/chat/conversation"

export async function ChatBoot() {
  const history = await fetchChatHistory()
  return <ChatWorkspace initial={conversationFromHistory(history)} />
}
```

The shell (header, composer) paints immediately; the message list streams in. No `useEffect`, no client fetch, no loading flag in the reducer.

### Driving the conversation (client component)

```tsx
// web/components/chat/chat-workspace.tsx
const [state, dispatch] = useReducer(reduce, initial)

const { sendJsonMessage } = useChatWebSocket(socketUrl, {
  onMessage: (event) => {
    const frame = ServerFrameSchema.safeParse(JSON.parse(event.data))
    if (!frame.success) {
      return
    }
    dispatch(frame.data)
  },
  onClose: () => {
    dispatch({ type: "ui.transport", transport: { status: "connecting" } })
  },
})

function submit(text: string, attachments: ChatMessageAttachment[]) {
  const messageId = crypto.randomUUID()
  const parts = [{ type: "text" as const, content: text }]
  dispatch({ type: "ui.submit", messageId, parts, attachments })
  sendJsonMessage(SubmitFrameSchema.parse({ type: "submit", messageId, parts }))
}
```

`dispatch(frame)` — server frames *are* reducer actions. No translation layer, no `applyServerMessage` switch that re-derives `userId` out of the connection status.

### The composer (never disabled)

```tsx
// web/components/chat/chat-main.tsx
<ChatComposer
  status={chatStatus(state)}       // "connecting" | "idle" | { running: runId }
  onSubmit={submit}
  onStop={(runId) => sendJsonMessage({ type: "stop", runId })}
/>
```

```tsx
// inside ChatComposer — draft is local, so the affordance is computed locally
const affordance = sendAffordance(status, draft.trim() === "" && images.length === 0)

// textarea has no `disabled` prop at all, ever
<Textarea value={draft} onChange={...} onKeyDown={handleKeyDown} />

{affordance.kind === "stop" ? (
  <Button aria-label="Stop" onClick={() => onStop(affordance.runId)}>
    <SquareIcon />
  </Button>
) : (
  <Button type="submit" aria-label="Send" disabled={affordance.kind === "send-disabled"}>
    <ArrowUpIcon />
  </Button>
)}
```

### The agent proposing rather than acting (backend)

```ts
// backend/edu-api/src/chat/route.ts
const route = await routeMessage(text, context, runner)

switch (route.kind) {
  case "command":
    return executeCommand(db, runner, context, route.command, emit, signal)
  case "reply":
    return streamReply(db, runner, context, route.text, emit, signal)
  case "proposal":
    return emitProposal(db, runner, context, route.proposal, emit)
}
```

Three outcomes, and only one of them mutates topic state without asking. `/new calculus` is a command. "explain the chain rule" is a reply — it writes nothing, so it needs no confirmation. "actually I want to do linear algebra instead" is a proposal, and the user sees a card with Confirm / Cancel before a single row changes.

---

## Shape

### Wire protocol (the frame log)

Extend the existing zod schemas in `backend/edu-api/src/messages/schema.ts`, mirrored in `web/lib/chat/ws-schema.ts`.

> **These two files are byte-identical today and both must change.** `web/` and `backend/edu-api/` are separate pnpm workspaces (`web/pnpm-workspace.yaml`, `backend/edu-api/pnpm-workspace.yaml`) with no shared package, so the duplication has been survivable. This change roughly triples the duplicated surface (4 server message types → 7 frames + 3 client frames + a proposal union). **Fix it first**: add a root `pnpm-workspace.yaml` and a `packages/chat-protocol` package exporting the schemas; both apps depend on it. Everything below assumes that package exists. If it does not land, the parity risk becomes the single largest source of runtime bugs in this redesign — a frame the server emits and the client's stale copy rejects is silently dropped by `safeParse`.

```ts
// packages/chat-protocol/src/parts.ts

export const TextPartSchema = z.object({ type: z.literal("text"), content: z.string() })
export const AttachmentPartSchema = z.object({ type: z.literal("attachment"), ref: z.string() })
export const OptionsPartSchema = z.object({
  type: z.literal("options"),
  options: z.array(z.object({ label: z.string() })),
})

export const ProposalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create-topic"),
    title: z.string(),
    summary: z.string(),
    part: z.string(),
  }),
  z.object({
    kind: z.literal("update-topic"),
    title: z.string().nullable(),
    summary: z.string().nullable(),
    part: z.string().nullable(),
    reason: z.string(),
  }),
  z.object({ kind: z.literal("grade-answer"), question: z.string() }),
  z.object({ kind: z.literal("new-question"), focus: z.string() }),
])

export const ProposalPartSchema = z.object({
  type: z.literal("proposal"),
  proposalId: z.string(),
  prompt: z.string(),
  proposal: ProposalSchema,
})

export const MessagePartSchema = z.discriminatedUnion("type", [
  TextPartSchema,
  AttachmentPartSchema,
  OptionsPartSchema,
  ProposalPartSchema,
])
```

Adding a fourth variant is backward compatible for reads: existing `topic_message.parts` rows contain only the first three. No migration.

```ts
// packages/chat-protocol/src/frames.ts

export const ReadyFrameSchema = z.object({
  type: z.literal("ready"),
  userId: z.string(),
  pendingProposalId: z.string().nullable(),
  restore: z.array(ResponseMessageSchema),
})

export const RunStartFrameSchema = z.object({
  type: z.literal("run.start"),
  runId: z.string(),
  topicId: z.string().nullable(),
})

export const PartDeltaFrameSchema = z.object({
  type: z.literal("part.delta"),
  runId: z.string(),
  messageId: z.string(),
  partIndex: z.number().int().nonnegative(),
  text: z.string(),
})

export const PartEndFrameSchema = z.object({
  type: z.literal("part.end"),
  runId: z.string(),
  messageId: z.string(),
  partIndex: z.number().int().nonnegative(),
  part: MessagePartSchema,
})

export const RunEndFrameSchema = z.object({
  type: z.literal("run.end"),
  runId: z.string(),
  status: z.enum(["completed", "cancelled", "failed"]),
  topicId: z.string().nullable(),
  messages: z.array(ResponseMessageSchema),
  pendingProposalId: z.string().nullable(),
})

export const BusyFrameSchema = z.object({ type: z.literal("busy"), runId: z.string() })

export const ErrorFrameSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
  runId: z.string().nullable(),
})

export const ServerFrameSchema = z.discriminatedUnion("type", [
  ReadyFrameSchema,
  RunStartFrameSchema,
  PartDeltaFrameSchema,
  PartEndFrameSchema,
  RunEndFrameSchema,
  BusyFrameSchema,
  ErrorFrameSchema,
])

export const SubmitFrameSchema = z.object({
  type: z.literal("submit"),
  messageId: z.string(),
  parts: MessagePartsSchema.min(1),
})

export const DecisionFrameSchema = z.object({
  type: z.literal("decision"),
  proposalId: z.string(),
  decision: z.enum(["accept", "reject"]),
})

export const StopFrameSchema = z.object({ type: z.literal("stop"), runId: z.string() })

export const ClientFrameSchema = z.discriminatedUnion("type", [
  SubmitFrameSchema,
  DecisionFrameSchema,
  StopFrameSchema,
])
```

Three notes on what changed and why:

- `ChatRequestSchema.message` was a `string` that actually held the client-minted message **id** (`createTopicMessage(db, { id: parsed.message, ... })`). It is now named `messageId`, and the redundant `message` text field is gone — the text already lives in `parts`.
- `busy` and `error` no longer carry prose the client displays verbatim. The client knows what busy means; the server should not be writing UI copy.
- The old `response` frame is deleted. `run.end` replaces it and adds `status` and `pendingProposalId`.

### The invariant that makes the reducer trivial

> **The Durable Object mints every agent message id before it streams a single delta, and persists with that same id.**

So `part.delta` and the persisted row refer to the same message. `run.end.messages` is not a second copy of a thing the client already has — it is the *upgrade* of the optimistic streaming message to the persisted one (real `createdAt`, authoritative parts). The reducer drops trailing streaming messages of that run and appends `run.end.messages`. Same ids, same order, no duplicates, no merge logic, no map.

**Who wins when both would write the same message:** the Durable Object, always. The client's streaming message is a preview keyed by the DO's id; `run.end` overwrites it wholesale. The client never invents an agent message id.

`run.end.messages` contains only agent messages. The user message keeps the client-minted id (as today) and is already in the client's array.

### Client conversation model

```ts
// web/lib/chat/conversation.ts

export type Transport =
  | { status: "connecting" }
  | { status: "open"; userId: string }

export type Activity =
  | { status: "idle" }
  | { status: "running"; runId: string }

export type MessageState =
  | { kind: "streaming"; runId: string }
  | { kind: "final" }
  | { kind: "cancelled" }
  | { kind: "failed"; message: string }

export type ConversationMessage = {
  id: string
  role: MessageRole                      // "user" | "agent", from the protocol package
  parts: MessagePart[]
  state: MessageState
  attachments: ChatMessageAttachment[]   // client-only; user messages
}

export type ChatState = {
  transport: Transport
  activity: Activity
  topicId: string | null
  title: string
  pendingProposalId: string | null
  messages: ConversationMessage[]
}
```

`ChatConnection` (the old `connecting | ready | busy | error` union) is deleted. It conflated transport health with run activity, which is why `applyChatResponse` had to fish `userId` back out of the connection to rebuild it. Two independent facts, two independent unions. `error` is not a connection state either — a failed run is a property of a message, and a dead socket is `connecting` (the client auto-reconnects).

`ChatMessage.content: string` is deleted. The UI renders `parts`. `partsToText` currently flattens an options part into `"Confirm update, Cancel"` and shows it as prose — that is a rendering defect hiding inside the type. Options become buttons; proposals become a card.

### Events and the fold

```ts
export type ChatEvent =
  | ServerFrame
  | { type: "ui.transport"; transport: Transport }
  | { type: "ui.submit"; messageId: string; parts: MessagePart[]; attachments: ChatMessageAttachment[] }

export function reduce(state: ChatState, event: ChatEvent): ChatState
```

Server frames are dispatched unwrapped. Local events are namespaced `ui.*` so the union discriminates cleanly on `type`.

Sketch of the two interesting cases:

```ts
case "part.delta": {
  const tail = state.messages.at(-1)
  // Invariant: the DO streams one message at a time, in order. A delta for anything
  // but the tail means frames were dropped; the run.end repair will fix it.
  if (tail && tail.id === event.messageId) {
    return { ...state, messages: appendDelta(state.messages, event) }
  }
  return {
    ...state,
    messages: [...state.messages, streamingMessage(event)],
  }
}

case "run.end": {
  // Invariant: streaming messages for this run are a contiguous tail.
  const kept = dropTrailingRun(state.messages, event.runId)
  return {
    ...state,
    activity: { status: "idle" },
    topicId: event.topicId,
    pendingProposalId: event.pendingProposalId,
    messages: [...kept, ...event.messages.map(toConversationMessage(event.status))],
  }
}
```

`appendDelta` and `dropTrailingRun` are pure, live in the same file, and are the only two array manipulations in the reducer. If either ever needs an id→index map, the DO has broken the ordering invariant and the fix belongs there, not here.

```ts
export function conversationFromHistory(history: ChatHistory | null): ChatState
export function sendAffordance(status: ChatStatus, draftIsEmpty: boolean): SendAffordance
```

```ts
export type SendAffordance =
  | { kind: "send" }
  | { kind: "send-disabled"; reason: "connecting" | "empty" }
  | { kind: "stop"; runId: string }
```

```ts
export function sendAffordance(status: ChatStatus, draftIsEmpty: boolean) {
  if (status.kind === "running") {
    return { kind: "stop" as const, runId: status.runId }
  }
  if (status.kind === "connecting") {
    return { kind: "send-disabled" as const, reason: "connecting" as const }
  }
  if (draftIsEmpty) {
    return { kind: "send-disabled" as const, reason: "empty" as const }
  }
  return { kind: "send" as const }
}
```

Requirement 4 is now a total function over a three-case union, not a pair of booleans. `ChatComposer` loses its `disabled` prop entirely; there is no code path that can disable the textarea.

### Word buffer (pure)

```ts
// packages/chat-protocol/src/word-buffer.ts  (pure, shared, unit-testable)

export const WORDS_PER_FLUSH = 8

const WHITESPACE = new Set([" ", "\t", "\n", "\r"])

// A word counts as complete only once whitespace follows it, so a flush never
// splits a token — important because a half-token breaks markdown and katex parsing.
export function takeWordChunk(pending: string) {
  let words = 0
  let cut = -1
  let inWord = false

  for (let i = 0; i < pending.length; i += 1) {
    const char = pending[i]!
    if (!WHITESPACE.has(char)) {
      inWord = true
      continue
    }
    if (!inWord) {
      continue
    }
    inWord = false
    words += 1
    if (words === WORDS_PER_FLUSH) {
      cut = i + 1
      break
    }
  }

  if (cut === -1) {
    return { chunk: "", rest: pending }
  }
  return { chunk: pending.slice(0, cut), rest: pending.slice(cut) }
}
```

Callers hold `pending` themselves and flush the remainder directly at part completion — no drain wrapper.

### LLM streaming

```ts
// backend/edu-api/src/agents/llm.ts — added alongside callLlm, same result shape

export async function streamLlm(
  env: LlmEnv,
  params: {
    instructions: string
    input: string
    maxTokens?: number
    signal?: AbortSignal
    onDelta: (delta: string) => void
  },
) {
  // not implemented
  //   const stream = await createChatModel(env, maxTokens).stream(
  //     [new SystemMessage(params.instructions), new HumanMessage(params.input)],
  //     { signal: params.signal },
  //   )
  //   accumulate extractText(chunk.content) into text, call onDelta per chunk
  //   last chunk carries usage_metadata (requires streamUsage: true on ChatOpenAI)
  //   return the same { text, model, inputTokens, ... } shape as callLlm
}
```

```ts
// backend/edu-api/src/agents/runner.ts — mirrors llmCall exactly

async llmStream(params: {
  name: string
  instructions: string
  input: string
  signal?: AbortSignal
  onDelta: (delta: string) => void
})
```

`llmStream` records the same `agent_step` row and the same `model_usage` row as `llmCall`. Cost accounting and tracing are unchanged, which is why streaming is a two-method addition rather than a rewrite of the runner.

**Which calls stream:** only the ones whose output the user reads as prose — `generate_response` (answer), `generate_question` (new-question), `generate_welcome` (new-topic), and the topic explanation reply. Classification and JSON-extraction calls stay on `callLlm`; streaming JSON to a screen is pointless and streaming it into a word buffer is worse.

### Durable Object as run state machine

```ts
// backend/edu-api/src/do/chat.ts

type ActiveRun = { runId: string; controller: AbortController }

type PendingProposal = {
  proposalId: string
  proposal: Proposal
  // Present only in the no-topic case, where nothing can be persisted yet
  // because topic_message.topic_id is NOT NULL.
  preTopic: { messageId: string; parts: MessagePart[] } | null
}

export class ChatDurableObject extends DurableObject<Env> {
  #active: ActiveRun | null = null   // in-memory: an abort only matters within this isolate
  // ctx.storage: "pendingProposal" -> PendingProposal | absent
```

`webSocketMessage` parses the client frame **before** checking whether a run is active, then routes by type:

| frame | run active | run idle |
| --- | --- | --- |
| `submit` | emit `busy`, drop | start run |
| `stop` | abort `#active` | ignore (run already ended) |
| `decision` | emit `busy`, drop | resolve proposal, start run |

Today's code checks `agentRunning` first and rejects everything, which is precisely why Stop cannot work. Parse first, route second.

`WsAttachment` drops `agentRunning` and keeps `{ userId }`. Run activity is `#active` (per-isolate, matching the lifetime of the abort controller it guards) rather than serialized onto every socket. The old attachment hand-validation (the `typeof parsed.agentRunning !== "boolean"` block) is replaced by a zod parse of `{ userId }`.

---

## Module map

**New shared package**

| file | why |
| --- | --- |
| `packages/chat-protocol/src/{parts,frames,word-buffer}.ts` | single source for schemas + the pure buffer |
| root `pnpm-workspace.yaml` | there is no root workspace today |

**Backend (`backend/edu-api/src/`)**

| file | change |
| --- | --- |
| `messages/schema.ts` | re-export the protocol package; delete the local copy |
| `agents/llm.ts` | add `streamLlm` |
| `agents/runner.ts` | add `llmStream` |
| `agents/parsed-output.ts` | `parseJsonFromLlm` returns `T \| null`; drop the `fallback` param; add `RouteClassificationSchema` |
| `chat/intent.ts` | `deduceIntent` → `routeMessage`, returning `Route` |
| `chat/proposals.ts` | **new** — pure `proposalFromClassification`, `proposalToPart` |
| `chat/route.ts` | `handleChat` → `runChat(..., emit, signal)`; delete `handleNoTopic`'s auto-create |
| `chat/update-topic.ts` | delete `applyUpdateDirect`, `isConfirmation`, `isRejection`, `findPendingUpdate` |
| `chat/{answer,new-question,new-topic}.ts` | prose call switches to `runner.llmStream` |
| `messages/persistence.ts` | add `loadTopicMessages` (all, ascending); keep `loadRecentMessages(8)` for the agent |
| `do/chat.ts` | run state machine, abort, proposal storage, frame emission |
| `index.ts` | add `GET /chat/history` |

**Web (`web/`)**

| file | change |
| --- | --- |
| `lib/chat/ws-schema.ts` | re-export the protocol package; delete the local copy |
| `lib/chat/conversation.ts` | **new** — `ChatState`, `reduce`, `conversationFromHistory`, `sendAffordance` |
| `lib/chat/state.ts` | **deleted** — live logic moves to `conversation.ts` |
| `lib/chat/seed.ts` | **deleted** — initial state comes from the server |
| `lib/chat/types.ts` | shrinks to `ChatMessageAttachment` |
| `lib/chat/history.ts` | **new**, `server-only` — bearer fetch + zod parse |
| `lib/chat/markdown-fences.ts` | **new** — `closeOpenMarkdown` |
| `app/(app)/page.tsx` | Suspense + `ChatBoot` |
| `app/layout.tsx` | `import "katex/dist/katex.min.css"` |
| `components/chat/chat-boot.tsx` | **new** async server component |
| `components/chat/chat-skeleton.tsx` | **new** Suspense fallback |
| `components/chat/chat-workspace.tsx` | `useReducer`, dispatch frames, send stop/decision |
| `components/chat/chat-main.tsx` | pass `status` down; drop `composerDisabled` |
| `components/chat/chat-composer.tsx` | no `disabled`; Stop button |
| `components/chat/message-list.tsx` | render `parts` |
| `components/chat/markdown-message.tsx` | **new** |
| `components/chat/message-parts.tsx` | **new** — options buttons, proposal card |

**Call-chain check.** Tracing a send: `chat-composer.tsx` → `chat-workspace.tsx` → `conversation.ts`. Three files. Tracing a stream flush: `do/chat.ts` (emit) → `conversation.ts` (fold) → `message-list.tsx` (render). Three files.

---

## Streaming path, end to end

```ts
// backend/edu-api/src/do/chat.ts — the emit closure handed to runChat

function createEmitter(ws: WebSocket, runId: string) {
  let messageId = ""
  let partIndex = 0
  let pending = ""

  return {
    beginMessage(id: string) {
      messageId = id
      partIndex = 0
    },
    delta(text: string) {
      pending += text
      // Loop: a single model chunk can carry more than 8 words.
      for (;;) {
        const taken = takeWordChunk(pending)
        if (taken.chunk === "") {
          return
        }
        pending = taken.rest
        send(ws, { type: "part.delta", runId, messageId, partIndex, text: taken.chunk })
      }
    },
    endPart(part: MessagePart) {
      if (pending !== "") {
        send(ws, { type: "part.delta", runId, messageId, partIndex, text: pending })
        pending = ""
      }
      send(ws, { type: "part.end", runId, messageId, partIndex, part })
      partIndex += 1
    },
  }
}
```

Sequence for "give me a practice question":

1. Client dispatches `ui.submit` (user bubble appears instantly) and sends the `submit` frame.
2. DO sets `#active`, sends `run.start`.
3. DO mints `messageId = "msg_" + nanoid()`, calls `emit.beginMessage(messageId)`.
4. `runner.llmStream({ onDelta: emit.delta })` — a `part.delta` goes out every 8 complete words.
5. Generation ends: `emit.endPart(textPart(fullText))` flushes the tail and sends the authoritative part.
6. Options are a non-streamed part: `emit.endPart(optionsPart([...]))` at `partIndex 1`.
7. DO persists with `createTopicMessage(db, { id: messageId, topicId, role: "agent", parts })` — the id it already streamed under.
8. DO sends `run.end` with the persisted message; the reducer swaps the preview for the real row.

Persistence happens **after** streaming, in one write. `topic_message` gains no streaming rows and needs no migration. The cost is a window (roughly the length of one run) in which a hard DO eviction loses the text the user just watched appear — accepted below.

---

## Markdown rendering

```tsx
// web/components/chat/markdown-message.tsx
"use client"

import ReactMarkdown, { type Components } from "react-markdown"
import rehypeKatex from "rehype-katex"
import remarkMath from "remark-math"

const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-[0.9em]">{children}</code>,
  pre: ({ children }) => <pre className="mb-2 overflow-x-auto rounded-md bg-muted p-3 text-sm last:mb-0">{children}</pre>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  h1: ({ children }) => <h1 className="mb-2 text-xl font-bold last:mb-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 text-lg font-bold last:mb-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 text-base font-semibold last:mb-0">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-muted-foreground/40 pl-3 italic last:mb-0">{children}</blockquote>
  ),
}

export function MarkdownMessage({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
      {text}
    </ReactMarkdown>
  )
}
```

The itsme component list, plus the two math plugins. Roughly 40 lines, not 1800.

### The streaming-markdown problem

Flushing every 8 words means the renderer regularly sees `The derivative is $\frac{d` — an unterminated math span, or an unterminated code fence. `rehype-katex` will render an error node, and the user watches red flicker through every equation. This is the one genuinely tricky piece of the markdown work:

```ts
// web/lib/chat/markdown-fences.ts

// Streamed text is parsed mid-token. Temporarily close unterminated inline math,
// display math, and code fences so katex and the code renderer see valid input.
// Applied only to messages in the "streaming" state; final text is rendered as-is.
export function closeOpenMarkdown(text: string) {
  // not implemented
  //   scan left to right, tracking: inside ``` fence, inside $$ block, inside $ inline
  //   (a $ is inline math only when not escaped as \$)
  //   append the closers for whatever is still open, innermost first
  //   return the text unchanged when nothing is open (the common case)
}
```

`MessageRow` calls it only for `state.kind === "streaming"`. Once `run.end` lands, the text is complete and goes through unmodified. Not shared, not abstracted — one call site, one reason to exist.

**User messages stay plain.** They keep `SkillInlineText` + `whitespace-pre-wrap`. Rendering a student's typed `$` or `#` as markdown would mangle what they wrote back at them. Agent text is markdown; skill chips are dropped from agent messages (the agent does not emit `@skill` tokens today).

---

## History fetch

**Backend** — `GET /chat/history`, added to `index.ts` next to `GET /topics`, same `requireUser` + `withCors` shape:

```ts
// returns { topic: { id, title, summary, part } | null, messages: ResponseMessage[] }
export async function loadTopicMessages(db: Db, topicId: string) {
  const rows = await db
    .select()
    .from(topicMessage)
    .where(eq(topicMessage.topicId, topicId))
    .orderBy(asc(topicMessage.createdAt))

  // Parts that fail to parse are dropped, matching loadRecentMessages —
  // one bad row must not blank the whole history.
  return rows.map(toPersistedMessage)
}
```

The `topic_message_topic_idx` index on `(topic_id, created_at)` already covers this exactly.

**Web** — server-only fetch with a zod boundary:

```ts
// web/lib/chat/history.ts
import "server-only"

export const ChatHistorySchema = z.object({
  topic: z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    part: z.string().nullable(),
  }).nullable(),
  messages: z.array(ResponseMessageSchema),
})

export async function fetchChatHistory() {
  const session = await getSession()   // cache()d in auth-server.ts; the layout already called it
  if (!session) {
    return null
  }

  const response = await fetch(new URL("/chat/history", env.NEXT_PUBLIC_API_URL), {
    headers: { Authorization: `Bearer ${session.session.token}` },
    cache: "no-store",
  })

  if (!response.ok) {
    return null
  }
  return ChatHistorySchema.parse(await response.json())
}
```

Bearer token, matching the `better-auth` bearer plugin path that `requireUser` already handles. `getSession` is wrapped in `cache()`, so the layout's auth gate and this call share one lookup.

`conversationFromHistory` maps it to `ChatState` with `transport: { status: "connecting" }`, `activity: { status: "idle" }`, every message `{ kind: "final" }`, and `pendingProposalId: null` (the `ready` frame supplies the live one moments later).

A returning user now sees their whole conversation in the SSR payload before the websocket has finished its handshake. `initialChatUiState` and the "New chat" empty state stop lying.

---

## Stop / abort

**Client.** `sendAffordance` returns `{ kind: "stop", runId }` whenever `activity.status === "running"`. Clicking sends `{ type: "stop", runId }`. The client does **not** optimistically clear activity — the DO confirms via `run.end { status: "cancelled" }`. One writer.

**Server.**

```ts
case "stop": {
  if (this.#active?.runId === frame.runId) {
    this.#active.controller.abort()
  }
  // A stop for a finished run is a no-op: run.end was already sent.
  return
}
```

The controller's signal is threaded `runChat → runner.llmStream → streamLlm → chat.stream(msgs, { signal })`.

On abort, `runChat` catches, and:

- If any text was streamed, persist it as an agent message under the id already streamed, so history matches exactly what the user saw. No "[stopped]" marker is written into the text; cancellation is metadata.
- If nothing was streamed, persist nothing.
- `runner.complete("cancelled")` — the existing runner already accepts this status and writes it to `agent_run.status`.
- Send `run.end { status: "cancelled", messages: [...] }`. The reducer marks those messages `{ kind: "cancelled" }` and `MessageRow` renders a small "Stopped" label.
- `#active = null`, and any pending word-buffer text is discarded (it was already flushed by the persist path or was never a complete word).

**Race — stop arrives after `run.end`:** the id no longer matches `#active`, so it is dropped server-side; the client is already idle. Harmless.

**Race — stop arrives before `run.start` is processed:** impossible. `run.start` is emitted synchronously when the submit frame is handled, before any await, so the client cannot hold a `runId` for a run the DO has not registered.

**The delivery assumption.** This requires Cloudflare to deliver the `stop` websocket event while `webSocketMessage` for the earlier `submit` is still awaiting the LLM. The DO input gate defers events during *storage* operations, not during arbitrary network awaits, so this should hold. It is the load-bearing assumption of the whole feature and is listed as risk #1 below, with a fallback.

---

## Confirmation flow

### Routing

```ts
// backend/edu-api/src/chat/intent.ts

export type Command =
  | { type: "new-topic"; message: string }
  | { type: "update-topic"; message: string }
  | { type: "answer"; message: string }
  | { type: "new-question"; message: string }
  | { type: "topic"; message: string }

export type Route =
  | { kind: "command"; command: Command }     // explicit — execute
  | { kind: "proposal"; proposal: Proposal }  // inferred — ask first
  | { kind: "reply"; text: string }           // inferred chat — answer, write nothing
  | { kind: "decision"; decision: "accept" | "reject" }

export async function routeMessage(message: string, context: AgentContext, runner: AgentRunner) {
  const explicit = parseExplicitCommand(message)
  if (explicit) {
    await runner.recordRoutingStep("route", { message }, { kind: "command", command: explicit })
    return { kind: "command" as const, command: explicit }
  }
  // not implemented
  //   classify with runner.llmCall into RouteClassificationSchema:
  //     { action: "chat" | "create-topic" | "update-topic" | "grade-answer" | "new-question"
  //           | "decide", decision?: "accept" | "reject", title?, summary?, part?, question?, focus? }
  //   the "decide" action is offered to the classifier ONLY when a proposal is pending
  //   parseJsonFromLlm returns null on junk -> return a reply asking the user to rephrase
  //   action "chat"     -> { kind: "reply" }
  //   action "decide"   -> { kind: "decision" }
  //   anything else     -> { kind: "proposal", proposal: proposalFromClassification(...) }
}
```

`/topic` currently maps to `answer`, which means "tell me about this topic" gets graded as if it were a submitted solution. It becomes its own command.

### `parseJsonFromLlm` loses its fallback

```ts
export function parseJsonFromLlm<T extends z.ZodType>(schema: T, response: string) {
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return null
  }
  const result = schema.safeParse(safeJsonParse(jsonMatch[0]))
  if (result.success) {
    return result.data
  }
  return null
}
```

Removing the third parameter makes the compiler walk every call site. Each one must now decide what to do with `null`, and the answer is always the same: ask the user. Today the fallbacks fabricate a title (`topicContent.slice(0, 80)`), a summary (`Student wants to learn about ${topicContent}`), and — worst — a question (`{ found: true, question: questionResult }` in `answer.ts`, which feeds the model's own raw classifier output into the verifier as if it were the exam question). This is the single highest-leverage deletion in the redesign.

### Where a proposal lives, and who owns it

```
DO storage "pendingProposal"  →  authoritative for executability
topic_message part            →  the display record
```

The DO storage entry decides what an `accept` actually does. The persisted `ProposalPart` is what the message list draws. `pendingProposalId` (broadcast on `ready` and on every `run.end`) tells the client which card is live; every other proposal part in the history renders inert, greyed, with its outcome. This is what stops a reload from showing three sets of live Confirm buttons.

**At most one proposal is pending per user.** A new proposal overwrites the storage entry; the superseded `proposalId` becomes stale. A `decision` for a stale id gets an `error` frame and an agent message: "That suggestion is no longer current." The DO is a per-user object (`idFromName(userId)`), so "per user" is enforced by the object boundary, not by a lock.

### The no-topic case

`topic_message.topic_id` is `NOT NULL` and `agent_run` requires a topic, so a user with no topic has nowhere to persist. Rather than a nullable-column migration, the pre-topic exchange lives entirely in DO storage (`PendingProposal.preTopic`) and in client memory:

1. User types "I want to learn integration by parts" with no current topic.
2. DO calls the LLM to draft a topic, stores `{ proposalId, proposal: { kind: "create-topic", ... }, preTopic: { messageId, parts } }`, sends the proposal as a `part.end` on a synthetic message. Nothing is written to D1.
3. On `accept`: create the topic, `setCurrentTopic`, persist the held `preTopic` user message, then run `executeNewTopicContinuation` and stream the welcome.
4. On `reject`: clear storage, agent message suggesting `/new <subject>`.

Reload while pending: `GET /chat/history` returns empty (correctly — nothing is persisted), and the `ready` frame carries `restore: [...]` with the pre-topic user message and the proposal, plus `pendingProposalId`. The reducer appends restore entries the history did not contain. When a topic *does* exist, `restore` is empty and `pendingProposalId` alone re-arms the card that history already delivered.

`handleNoTopic`'s unconditional `createTopic` + `setCurrentTopic` is deleted. `/new <subject>` with no topic remains a direct create — the user said it explicitly.

### `update-topic` cleanup

`executeUpdateTopic` currently checks a pending proposal, then falls through to `applyUpdateDirect` whenever `message.length > 0` — which is nearly always, so the confirm path it carefully built is dead code. Deleted, along with `isConfirmation` / `isRejection` (`lower === "yes"`) and `findPendingUpdate` (which reverse-scans `agent_step` rows named `pending_topic_update` to reconstruct state that should never have been inferred from a trace log). What remains: `applyUpdate(db, context, topicId, update)`, called from exactly one place — the `accept` branch of a `decision`.

### Where confirmation is *not* required

Answering a question writes nothing to topic state. Requiring "shall I answer that? [y/n]" would make the product unusable. **The line: confirmation is required for anything that mutates topic state (`create-topic`, `update-topic`, `new-question`) or grades the user (`grade-answer`); pure explanation streams straight back as a `reply`.** Grading is on the confirming side of the line deliberately — "treating text as an answer vs a question" is called out in the requirement, and mis-grading a student's musing as a wrong answer is the exact failure mode to prevent.

The classifier's `chat` rate is the tuning knob for the whole feature. Too eager and the app nags; too shy and it silently guesses again.

---

## Synthesis decision

pending parent synthesis

---

## Tradeoffs accepted

**A shared protocol package is a prerequisite, not an optional cleanup.** Two workspaces, no root — someone has to add one before any of this lands. Paid because the alternative is maintaining a 250-line schema in two files that must stay bit-identical, where drift fails silently through `safeParse`.

**Streamed text is not durable until the run ends.** A DO eviction mid-run loses text the user watched appear. Paid because per-flush D1 writes would add a row (or an UPDATE) every 8 words for zero user-visible benefit, and would require a streaming-state column plus a reaper for orphaned partials. Runs are seconds long.

**`run.end` re-sends message content the client already rendered.** Duplicated bytes, bounded at 1–3 messages. Paid because it makes the reducer's repair path identical to its happy path — one code path handles "you have it already", "you missed some deltas", and "the run was cancelled".

**Agent messages lose skill chips.** `SkillInlineText` no longer runs on agent text. Paid because the agent does not emit `@skill` tokens today, and threading chips through react-markdown's text renderer is exactly the 1800-line road this design refuses to take.

**Every inferred mutation costs a round trip.** The user must click Confirm. Paid because the alternative is the current behavior, where a stray sentence silently rewrites the learning plan. The `reply` escape hatch keeps the common case (asking a question) at zero friction.

**`part.delta` targets the tail message only.** Concurrent multi-message streaming is unrepresentable. Paid deliberately — it is what keeps the reducer free of an id→index map. If the agent ever needs to stream two messages at once, the protocol changes, not the client's data structure.

**Deleting `parseJsonFromLlm`'s fallback makes the agent visibly refuse more often.** Paid because a refusal is honest and a fabricated exam question is not.

---

## Alternatives considered

### Rejected: server-authoritative snapshot streaming

Every flush sends the full current message list; the client replaces state wholesale. No reducer, no ids to reconcile, no ordering invariant — the trivially correct design.

Rejected on cost and on ambiguity. A 600-word answer at 8 words per flush is 75 frames, each carrying the entire growing conversation — quadratic bytes, and it re-serializes the whole history on every flush for a returning user with 200 messages. Worse, it has no way to express "this text is provisional": a snapshot looks identical whether the run finished or was cut off, so Stop has to bolt a status field back on, and once you have per-message status you have re-derived the frame log with extra steps.

### Rejected: keep intent-then-execute, add a text confirmation protocol

Leave `deduceIntent` returning an intent, keep executing it, and put confirmation where `update-topic` already tries to: print "Reply confirm to apply" and string-match the next message.

Rejected because that *is* the bug. `isConfirmation` matches `"confirm"`, `"yes"`, or a substring of `"confirm update"` — so a student who types "yes, and also can you explain why" gets a plan rewrite plus a dropped question, and one who types "sure" gets nothing. The pending state is reconstructed by reverse-scanning `agent_step` rows for a step *named* `pending_topic_update`, which turns an append-only trace log into load-bearing application state. And it inverts the requirement: the system commits to an intent, then asks. The proposal shape refuses to build the thing until the user says so, and carries the decision as a typed `proposalId` that cannot be produced by typing prose.

### Rejected: SSE for the run, websocket for control

`POST /chat` returns a `text/event-stream`; the websocket carries only `ready` / `stop`. Streaming HTTP is the boring, well-trodden path, and it makes the DO's concurrency story simpler.

Rejected because it splits one conversation across two transports with two auth paths (bearer header vs `?token=`), and reconnection gets *worse*: a dropped SSE stream mid-run leaves the client with no channel to ask "is my run still alive?", whereas the websocket's `ready` frame answers that on reconnect by construction. The existing DO already owns per-user socket state; adding a second stream duplicates it.

### Considered and folded in: streaming deltas as opaque tokens

An earlier shape streamed raw model tokens and let the client buffer into 8-word chunks. Moved server-side instead: the requirement is about what goes on the wire, the buffer is one pure function either way, and buffering on the server means one implementation rather than one per client.

---

## Open questions and risks

1. **DO event delivery during an LLM await.** Stop only works if Cloudflare delivers the `stop` websocket event while `webSocketMessage` for the `submit` is still pending on a network await. The input gate should only defer during storage operations, but this must be verified with a live test before anything else is built — it is the load-bearing assumption. **Fallback if it does not hold:** stop goes over HTTP (`POST /chat/stop` → `stub.fetch`), which is unambiguously a separate event. The client-side shape is unchanged; only the transport for one frame moves.
2. **LangChain `.stream()` on OpenRouter.** Need to confirm token deltas arrive incrementally (not one terminal chunk) and that `usage_metadata` lands on the final chunk with `streamUsage: true`. If usage is unavailable when streaming, `model_usage` falls back to `estimateTokens`, which already exists in `llm.ts` — cost figures get slightly less precise for streamed calls.
3. **LegendList with growing items.** `recycleItems` + `maintainScrollAtEnd` + `estimatedItemSize={72}` against an item that grows every 8 words. Coarse flushes help (this is a second reason 8 words beats per-token), but measurement churn and scroll jitter need a real test with a long answer. Mitigation if it misbehaves: render the streaming tail message outside the virtualized list.
4. **Unbounded history.** "All messages" is the stated requirement and the index covers it, but a heavy user on one topic will eventually SSR a large payload. The frame log makes the eventual fix additive — cursor pagination on `/chat/history` plus a "load older" prepend action on the reducer — but it is not designed in.
5. **`closeOpenMarkdown` correctness.** Escaped `\$`, currency in prose ("costs $5 and $10" reads as inline math to `remark-math`), and nested fences are all easy to get subtly wrong. Needs a table-driven unit test before it goes near the render path.
6. **Confirmation fatigue.** If the classifier routes to `proposal` where a human would expect `reply`, the app feels broken in a way no test catches. Needs a fixture set of ~30 real student messages with expected routes, run as a test.
7. **katex CSS.** ~23KB of CSS plus font files in the global layout. Acceptable for an education app, worth measuring against LCP.
8. **`restore` on `ready` overlapping history.** Designed to be empty whenever a topic exists, but if that invariant ever breaks the reducer must dedupe by id. Reducer should ignore restore entries whose ids are already present, and that behavior needs a test rather than a comment.
9. **Attachments during a run.** The composer stays enabled, so a user can attach images while a run streams. The submit is blocked, but the attachment state survives — probably correct, unverified against the `revokeComposerImageAttachment` cleanup path.

---

## Next implementation step

**Step 1 — prove the frame log on one path, end to end.**

1. Add the root `pnpm-workspace.yaml` and `packages/chat-protocol`; move the schemas out of both copies; add `word-buffer.ts` with table-driven tests (empty, 7 words, 8 words, 8 words with no trailing space, multi-chunk, whitespace runs, CJK-free ASCII only for now).
2. Spike the DO stop-delivery question (risk #1) with a throwaway 30-second `await` in `webSocketMessage` and a `stop` sent from the browser console. Everything after this depends on the answer.
3. Add `streamLlm` + `runner.llmStream`, and convert **only** `executeNewQuestion` to stream. One path, one prompt, no branching.
4. Rewrite the DO around `#active` + `createEmitter`, emitting `run.start` / `part.delta` / `part.end` / `run.end` for that one path. Mint the message id up front; persist with it.
5. Replace `state.ts` with `conversation.ts` and `useReducer`; render `parts` in `message-list.tsx` as plain text still. Delete `seed.ts`.

At the end of step 1, "give me a practice question" streams in 8-word chunks and Stop works, with markdown, history, and proposals untouched. If the DO delivery assumption fails, it fails here — before four other features are built on top of it.

Then, in order: **(2)** composer affordance + Stop UI polish, **(3)** markdown + katex + `closeOpenMarkdown`, **(4)** `/chat/history` + `ChatBoot` + Suspense, **(5)** proposals — routing, `parseJsonFromLlm` returning null, DO proposal storage, the confirmation card, and the deletion of `applyUpdateDirect` and `handleNoTopic`'s auto-create.

Proposals go last on purpose: it is the only one of the five that changes what the product *does* rather than how it feels, so it deserves to land on a foundation that is already proven.
