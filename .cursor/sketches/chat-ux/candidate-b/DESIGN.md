## Problem

The current chat path treats a run as one request followed by one complete response. That decision leaks into every defect:

- The Durable Object cannot stream or stop work because it awaits `handleChat`.
- The client stores flattened strings, so it cannot update one text part, render options as options, or reconcile a completed stream.
- Connection and run state are combined as `connecting | ready | busy | error`, so a busy run disables drafting.
- The server page has no current-topic snapshot to hydrate.
- Raw prose is classified and executed in one step. Classification mistakes mutate topic state, and malformed model JSON silently becomes invented data.

The redesign is a **run projection state machine**. The Durable Object owns one cancellable run. The client reducer owns a normalized projection of messages and independently tracks transport and run state. D1 stores committed messages and pending confirmations, never stream chunks.

## Usage (caller's view)

The public UI works with a chat snapshot and domain events. WebSocket JSON is parsed and translated before it reaches these calls.

### 1. Server-render the current topic and all of its messages

```tsx
export default async function Home() {
  const session = await getSession()
  const snapshotPromise = loadCurrentChatSnapshot(session.session.token)

  return (
    <Suspense fallback={<ChatWorkspaceSkeleton />}>
      <ChatWorkspaceLoader snapshotPromise={snapshotPromise} />
    </Suspense>
  )
}

async function ChatWorkspaceLoader({ snapshotPromise }: Props) {
  const snapshot = await snapshotPromise
  return <ChatWorkspace initialSnapshot={snapshot} />
}
```

`loadCurrentChatSnapshot` performs a server-side `GET /topics/current/messages` with `Authorization: Bearer <session token>`, parses the response with zod, and maps it to the UI model. The browser never receives a raw HTTP response shape.

### 2. Send, stream, complete, and reconcile one message

```tsx
const [state, dispatch] = useReducer(chatReducer, initialSnapshot, createChatState)

function sendDraft(draft: ComposerDraft) {
  const command = beginSend(state, draft)
  if (command.kind === "blocked") {
    return
  }

  dispatch({ type: "user-sent", message: command.optimisticMessage })
  socket.send(encodeClientCommand(command.socketCommand))
}

function receiveSocketData(data: string) {
  const event = parseServerEvent(data)
  if (!event) {
    return
  }
  dispatch(event)
}
```

The sender inserts the user message optimistically. The Durable Object persists that same ID and broadcasts `user-committed`; the reducer replaces the pending variant instead of appending a duplicate. Assistant text has one writer, the Durable Object. The client only projects its events.

### 3. Keep drafting while the button changes from Send to Stop

```tsx
<ChatComposer
  draft={draft}
  action={composerAction(state)}
  onDraftChange={setDraft}
  onSend={sendDraft}
  onStop={(runId) => {
    socket.send(encodeClientCommand({ type: "stop", runId }))
  }}
/>
```

`ChatComposer` never disables its textarea or attachment controls. Its action is a discriminated union:

- `send-disabled` while connecting, disconnected, or empty
- `send-ready` when a draft may be submitted
- `stop-ready` while a run is active
- `stop-pending` after Stop is pressed

Pressing Enter calls the same action. It does nothing unless the action is `send-ready`. While running, only the Stop button can submit.

### 4. Stream only user-visible model output

```ts
const result = await runner.streamText({
  name: "generate_response",
  instructions,
  input,
  signal: run.signal,
  onText: run.output.appendText,
})

await run.output.completeMessage([
  textPart(result.text),
  optionsPart(followUpOptions),
])
```

Routing and structured generation continue to use non-streaming calls. Final explanations, questions, and welcome text use `streamText`. The output session assigns the assistant message ID, broadcasts buffered deltas, and commits the full message once.

### 5. Ask before acting on inferred intent

```ts
const decision = await decideIntent({
  text: messageText,
  context,
  classify: runner.classify,
})

if (decision.kind === "explicit") {
  return await executeExplicitIntent(run, decision.intent)
}

return await createIntentConfirmation(run, decision.proposal)
```

An inferred proposal writes no topic state and performs no answer evaluation. It creates a persisted confirmation with buttons such as "Treat this as an answer" and "Ask about the topic". Accepting a button sends a typed confirmation command, not the button label as new prose.

## Shape

### Data structures first

The client starts with the lookup structures streaming needs. No later scan or map conversion is required.

```ts
type ChatState = {
  transport: TransportState
  run: RunState
  conversation: ConversationState
}

type ConversationState =
  | {
      kind: "no-topic"
      messageOrder: string[]
      messagesById: Record<string, UiMessage>
    }
  | {
      kind: "topic"
      topic: { id: string; title: string }
      messageOrder: string[]
      messagesById: Record<string, UiMessage>
    }

type TransportState =
  | { kind: "connecting" }
  | { kind: "ready"; userId: string }
  | { kind: "failed"; message: string }

type RunState =
  | { kind: "idle" }
  | { kind: "running"; runId: string; assistantMessageId: string }
  | { kind: "stopping"; runId: string; assistantMessageId: string }

type ComposerAction =
  | { kind: "send-disabled"; reason: "connecting" | "disconnected" | "empty" }
  | { kind: "send-ready" }
  | { kind: "stop-ready"; runId: string }
  | { kind: "stop-pending"; runId: string }

type UiMessage =
  | {
      kind: "pending-user"
      id: string
      parts: UiPart[]
    }
  | {
      kind: "committed"
      id: string
      role: "user" | "assistant"
      parts: UiPart[]
      createdAt: string
      finishReason: "completed" | "stopped"
    }
  | {
      kind: "streaming-assistant"
      id: string
      runId: string
      parts: UiPart[]
      nextSequence: number
    }

type UiPart =
  | { kind: "text"; content: string }
  | { kind: "attachment"; ref: string }
  | { kind: "options"; items: UiOption[] }

type UiOption = {
  id: string
  label: string
  action: UiOptionAction
}

type UiOptionAction =
  | { kind: "confirm"; confirmationId: string }
  | { kind: "reject"; confirmationId: string }
  | { kind: "send-command"; command: string }
```

`UiPart` is intentionally a UI model rather than `WsMessagePart`. The boundary mapper creates it after zod parsing. This keeps wire concerns out of `ChatMain`, `MessageList`, and `ChatComposer`.

The Durable Object has one state machine for the user, not one `agentRunning` flag per socket:

```ts
type ActiveRun =
  | { kind: "idle" }
  | {
      kind: "running"
      runId: string
      controller: AbortController
      sourceMessageId: string
    }
```

All sockets attached to the user's Durable Object receive run events. This keeps two tabs consistent. `this.ctx.waitUntil(executeRun(...))` keeps the run alive, while `webSocketMessage` returns immediately so a later Stop command can abort it. The DO must not wrap execution in `blockConcurrencyWhile`, because that would block Stop.

### Shared zod contract

`web/lib/chat/ws-schema.ts` and `backend/edu-api/src/messages/schema.ts` currently duplicate the same schemas. That is already a contract drift bug. Move the shared zod schemas to `packages/chat-contract/src/index.ts`; keep the two existing modules as temporary re-exports so call sites migrate without a large diff. Extend the existing schemas rather than creating parallel handwritten wire types.

```ts
const TopicRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("selected"), topicId: z.string() }),
])

const OptionActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("confirm"), confirmationId: z.string() }),
  z.object({ type: z.literal("reject"), confirmationId: z.string() }),
  z.object({ type: z.literal("send-command"), command: z.string() }),
])

const OptionItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  action: OptionActionSchema,
})

const ClientCommandSchema = z.discriminatedUnion("type", [
  ChatRequestSchema.extend({ type: z.literal("message") }),
  z.object({ type: z.literal("stop"), runId: z.string() }),
  z.object({ type: z.literal("confirm"), confirmationId: z.string() }),
  z.object({ type: z.literal("reject"), confirmationId: z.string() }),
])

const ServerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), userId: z.string() }),
  z.object({
    type: z.literal("run-started"),
    runId: z.string(),
    userMessage: ResponseMessageSchema,
    assistantMessageId: z.string(),
    topic: TopicRefSchema,
  }),
  z.object({
    type: z.literal("text-delta"),
    runId: z.string(),
    messageId: z.string(),
    partIndex: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative(),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("message-completed"),
    runId: z.string(),
    message: ResponseMessageSchema,
  }),
  z.object({
    type: z.literal("run-finished"),
    runId: z.string(),
    outcome: z.enum(["completed", "stopped"]),
  }),
  z.object({
    type: z.literal("run-rejected"),
    reason: z.enum(["busy", "invalid-confirmation"]),
    message: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("connection") }),
      z.object({ kind: z.literal("run"), runId: z.string() }),
    ]),
    message: z.string(),
  }),
])
```

Types come from `z.infer`. JSON is parsed only in the HTTP and WebSocket adapters. `JSON.parse` results do not get cast.

`ResponseMessageSchema` gains `finishReason: "completed" | "stopped"`. `topic_message` gains the matching non-null column with a `"completed"` migration default. Stream chunks never create rows. A stopped run commits its non-empty partial assistant message once with `finishReason: "stopped"` so refresh does not erase text the user saw.

### Reducer and word buffer

The reducer is the only client writer:

```ts
function chatReducer(state: ChatState, event: ChatEvent) {
  // exhaustive switch; no I/O
}

function mapServerEvent(event: ServerEvent) {
  // boundary mapping from parsed wire data to ChatEvent
}

function upsertMessage(
  conversation: ConversationState,
  message: UiMessage,
) {
  // append ID only when absent; replace map entry when present
}

function appendTextDelta(
  message: Extract<UiMessage, { kind: "streaming-assistant" }>,
  event: TextDeltaEvent,
) {
  // ignore old sequences, reject gaps, append to the addressed text part
}
```

Tricky reducer branches should initially use `not implemented` bodies in the implementation sketch, then be filled with table-driven tests. The key invariants are:

- `messageOrder` contains each message ID once.
- `messagesById` has every ordered ID.
- A delta can only update the active run's assistant message.
- `message-completed` replaces that streaming message under the same ID.
- `run-finished` only idles the matching run. Late events from an old run cannot end a newer run.

The server buffer is also pure:

```ts
type WordBufferState = {
  pending: string
  completedWords: number
}

function pushWordBuffer(
  state: WordBufferState,
  tokenText: string,
  wordsPerFlush: number,
) {
  // not implemented: preserve whitespace and emit each completed 8-word chunk
}

function finishWordBuffer(state: WordBufferState) {
  // not implemented: emit the remaining text at message-part completion
}
```

`streamText` feeds model token text into `pushWordBuffer(..., 8)`. A word completes when a following whitespace boundary arrives. `finishWordBuffer` emits the last partial word. Empty chunks are never sent. Each emitted delta gets the next monotonic sequence number.

### LLM and run signatures

```ts
async function callLlmStream(
  env: LlmEnv,
  params: {
    instructions: string
    input: string
    maxTokens?: number
    signal: AbortSignal
    onToken: (text: string) => void
  },
) {
  // ChatOpenAI.stream(..., { signal }); collect usage and final text
}

async function streamBufferedText(params: {
  source: AsyncIterable<string>
  signal: AbortSignal
  onDelta: (text: string) => void
}) {
  // owns the 8-word buffer
}

async function handleChat(
  db: Db,
  llmEnv: LlmEnv,
  userId: string,
  request: ChatRequest,
  run: RunSession,
) {
  // validation already occurred at the adapter
}

type RunSession = {
  runId: string
  signal: AbortSignal
  output: {
    appendText: (text: string) => void
    completeMessage: (parts: MessagePart[]) => Promise<void>
  }
}
```

Intermediate calls such as intent classification and JSON topic generation remain `invoke` calls. They accept the same `AbortSignal`, so Stop cancels the whole run, not only visible generation. `parseJsonFromLlm` loses its fallback argument and becomes strict:

```ts
function parseStructuredLlm<T extends z.ZodType>(
  schema: T,
  response: string,
) {
  // extract JSON, schema.parse, throw a named model-output error
}
```

The run catches that named error and asks the user to restate the request. It never invents a title, summary, part, question, or answer target.

### Stop and abort

Start handling has four steps:

1. Validate `message`.
2. If `activeRun` is running, return `run-rejected`.
3. Create the `AbortController`, assign `activeRun`, and broadcast `run-started`.
4. Start `executeRun` under `ctx.waitUntil` and return from the socket handler.

Stop handling checks both state and `runId`. A matching stop transitions the client to `stopping` and calls `controller.abort("user-stop")`. The run catches only the abort condition as cancellation, flushes already received buffered text, commits a non-empty partial message with `finishReason: "stopped"`, marks `agent_run.status = "cancelled"`, broadcasts completion events, then returns the DO to idle. Other errors mark the run failed.

Completion and Stop race through one `finishRun(runId, outcome)` gate. The first terminal transition wins. A Stop arriving after completion receives the already emitted completed outcome and does not rewrite the row.

### History fetch

Add `GET /topics/current/messages`.

The handler:

1. Calls `requireUser`, which already accepts Better Auth bearer tokens.
2. Loads `user_current_topic` joined to a topic owned by that user.
3. Returns `{ kind: "no-topic" }` or `{ kind: "topic", topic, messages }`.
4. Loads all `topic_message` rows in ascending `(createdAt, id)` order. This is intentionally separate from the eight-message context query used by the agent.
5. Parses JSON `parts` with `MessagePartsSchema`. Invalid stored rows fail the request and are logged with the message ID; they do not silently become empty messages.

The Next server client uses `getSession()` and `env.NEXT_PUBLIC_API_URL`, sends the bearer token, sets `cache: "no-store"`, parses `CurrentChatSnapshotResponseSchema`, and maps to `ChatSnapshot`. The authenticated layout remains the redirect authority. The endpoint still enforces ownership.

The Suspense boundary wraps the async loader, not `ChatWorkspace`. Hydration supplies the reducer initializer. No `useEffect` fetch or state synchronization is needed.

### Confirmation flow

Commands become five distinct intents:

```ts
const ExplicitIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new-topic"), text: z.string() }),
  z.object({ kind: z.literal("update-topic"), text: z.string() }),
  z.object({ kind: z.literal("answer"), text: z.string() }),
  z.object({ kind: z.literal("new-question"), text: z.string() }),
  z.object({ kind: z.literal("topic-question"), text: z.string() }),
])

const IntentDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("explicit"), intent: ExplicitIntentSchema }),
  z.object({
    kind: z.literal("inferred"),
    proposal: ExplicitIntentSchema,
    explanation: z.string(),
  }),
])
```

`/topic` maps to `topic-question`; it no longer aliases answer evaluation. Only the exact `/new`, `/update`, `/ans`, `/new-qns`, and `/topic` prefixes produce `explicit`.

An inferred decision creates a `pending_confirmation` row containing:

- ID and user ID
- nullable topic ID
- source user-message ID when a topic exists
- proposed intent JSON parsed by `ExplicitIntentSchema`
- status `pending | accepted | rejected`
- creation and resolution timestamps

This table is needed because a no-topic inference cannot be stored in `topic_message`, and a refresh or another tab must not make confirmation ambiguous.

The assistant confirmation uses an options part whose actions carry the confirmation ID. Accept and reject are dedicated client commands. The backend loads the row by confirmation ID and user ID, checks `pending`, marks it accepted or rejected once, then executes or cancels. It does not reclassify the original text.

Explicit `/new`, `/ans`, `/new-qns`, and `/topic` execute directly. Explicit `/update` generates a concrete update proposal but does not mutate the topic. It creates a second confirmation of kind `apply-topic-update`; acceptance applies the exact stored, zod-validated proposal. This fixes the current `applyUpdateDirect` bypass.

### Markdown

Add a small `AssistantMarkdown` component:

```tsx
function AssistantMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={chatMarkdownComponents}
    >
      {children}
    </ReactMarkdown>
  )
}
```

`chatMarkdownComponents` mirrors the reference's Tailwind treatment for paragraphs, lists, links, inline code, code blocks, headings, strong text, and blockquotes. Add table styling because educational explanations commonly compare values. Import `katex/dist/katex.min.css` once in the app stylesheet or root layout.

Only assistant and agent text parts use Markdown. User text keeps `SkillInlineText` and `whitespace-pre-wrap`. Options render as buttons from their own part rather than being flattened into comma-separated text. Partial Markdown may be temporarily unbalanced during a stream; `react-markdown` safely rerenders the current string.

### Module map

Shared contract and database:

- `packages/chat-contract/src/index.ts`: canonical zod schemas and inferred wire types.
- `web/lib/chat/ws-schema.ts`: temporary re-export plus UI boundary mapper.
- `backend/edu-api/src/messages/schema.ts`: temporary re-export.
- `backend/edu-api/db/schema.ts`: `topic_message.finishReason` and `pending_confirmation`.
- `backend/edu-api/drizzle/*`: migration with `"completed"` backfill.

Backend, with the send and stream path kept short:

- `backend/edu-api/src/do/chat.ts`: parse commands, own `ActiveRun`, broadcast, abort, terminal race gate.
- `backend/edu-api/src/agents/llm.ts`: `callLlmStream`, signal propagation, model text extraction.
- `backend/edu-api/src/agents/word-buffer.ts`: pure eight-word buffering.
- `backend/edu-api/src/agents/runner.ts`: `streamText`, strict structured calls, cancelled status.
- `backend/edu-api/src/chat/route.ts`: intent decision, confirmation boundary, dispatch.
- `backend/edu-api/src/chat/intent.ts`: explicit parser and inferred proposal, no execution.
- `backend/edu-api/src/chat/update-topic.ts`: always propose then apply stored confirmation.
- `backend/edu-api/src/chat/answer.ts`, `new-topic.ts`, `new-question.ts`: stream final user-visible text through `RunSession`.
- `backend/edu-api/src/chat/topic-question.ts`: conceptual question path for `/topic`.
- `backend/edu-api/src/confirmations/repository.ts`: create and atomically resolve pending confirmations.
- `backend/edu-api/src/messages/persistence.ts`: commit completed or stopped message; separate `loadAllMessages`.
- `backend/edu-api/src/index.ts`: current-topic history endpoint.
- `backend/edu-api/src/agents/parsed-output.ts`: strict parser, no fallbacks.

Frontend:

- `web/app/(app)/page.tsx`: Suspense boundary and async loader.
- `web/lib/chat/history.ts`: authenticated server fetch, zod parse, UI mapping.
- `web/lib/chat/types.ts`: normalized run projection model.
- `web/lib/chat/state.ts`: pure reducer and selectors.
- `web/lib/chat/ws.ts`: socket transport only.
- `web/components/chat/chat-workspace.tsx`: `useReducer`, event adapter, send and stop commands.
- `web/components/chat/chat-main.tsx`: pass `ComposerAction`, never a blanket disabled flag.
- `web/components/chat/chat-composer.tsx`: controlled draft and Send or Stop action.
- `web/components/chat/assistant-markdown.tsx`: simple Markdown, math, and Tailwind components.
- `web/components/chat/message-list.tsx`: render parts without flattening.
- `web/app/globals.css` or root layout: one KaTeX stylesheet import.

Tests:

- word-buffer token split, punctuation, whitespace preservation, exact eight words, and final partial flush
- reducer duplicate user ack, ordered deltas, stale delta, sequence gap, completion replacement, old-run finish, stopped completion
- strict command parsing and inferred confirmation with zero mutation
- one-shot confirmation resolution and cross-user rejection
- Stop during routing, Stop during streaming, and completion versus Stop race
- history ownership, no-topic response, all-message ordering, and invalid stored JSON

The hot traces stay bounded:

- send: `chat-workspace.tsx` to `state.ts` to `ws-schema.ts`
- stream flush: `llm.ts` to `word-buffer.ts` to `chat.ts`
- server history: `page.tsx` to `history.ts` to the worker endpoint

## Synthesis decision

pending parent synthesis

## Tradeoffs accepted

- The current-topic endpoint returns every message because that is the requirement. It will need cursor pagination or windowed hydration when topics become large. The `LegendList` keeps rendering cost bounded, but payload size still grows.
- A stopped assistant response is persisted as a stopped message. This adds a column and migration, but it prevents the visible transcript from changing after refresh.
- Pending confirmations get a table instead of living only in agent-step JSON. This costs one repository and migration, but gives atomic one-shot resolution, ownership checks, no-topic support, refresh safety, and clear audit history.
- The client keeps its optimistic user insert. A server-generated ID would simplify authority but make sending feel slower. Reusing the client message ID gives deterministic reconciliation.
- Shared schemas move to a workspace package. Temporary re-exports avoid an all-at-once import rewrite.

## Alternatives considered

### Append-only event log in D1

A structurally different design would persist every token or eight-word chunk as an event, then rebuild messages from the event log. I rejected it. D1 would receive many writes per answer, history reads would need folding, and partially written Markdown would become durable data. The product needs live projection, not event sourcing. One final message row plus ephemeral deltas is the smaller model.

### Keep arrays and locate the streaming message on every chunk

This preserves today's `Chat[] -> messages[]` shape. I rejected it because streaming immediately needs lookup by message ID, deduplication of optimistic messages, and replacement on completion. An ordered ID list plus record encodes those operations directly.

### Treat Stop as closing the WebSocket

Closing the socket does not prove the model request stopped, breaks reconnect state, and cannot distinguish user cancellation from network loss. A run-scoped abort command is explicit and testable.

### Put inferred commands into the transcript as hidden slash commands

The client could turn a confirmation click into `/ans original text`. I rejected it because hidden text transformation makes audit history misleading and allows stale confirmations to execute twice. A persisted confirmation ID gives exact, one-shot semantics.

## Open questions and risks

- Verify that the installed LangChain `ChatOpenAI.stream` forwards `AbortSignal` through OpenRouter in the Workers runtime. If it does not, use the OpenRouter streaming HTTP API directly inside `llm.ts`; the `callLlmStream` contract stays unchanged.
- Cloudflare Durable Object `waitUntil` must keep the instance alive for the active fetch. Add an integration test that hibernates an idle socket, starts a run, then stops it from a second socket.
- Existing option rows only contain labels. The history mapper should turn them into non-interactive display options. New rows use action-bearing options. A schema union with `legacy-options` at the persistence boundary is safer than inventing actions for old labels.
- The current topic message index is `(topicId, createdAt)`. Add `id` to the index or use it as a deterministic tie-break after loading so equal timestamps do not reorder.
- Topic creation has no `topic_message` location until the topic exists. The pending confirmation table covers inferred no-topic prose, but product must decide whether that pre-topic exchange should appear after creation. My default is yes: on acceptance, persist the original user text and confirmation message into the new topic before the welcome response.
- Multiple tabs can draft independently. They share server runs and transcript events, but drafts remain local by design.

## Next implementation step

Implement the shared zod contract, normalized reducer, and word-buffer tests first. Then add the history endpoint and server hydration. Once those boundaries are stable, convert the Durable Object to the cancellable run state machine, stream one final response path end to end, and migrate the remaining executors and confirmation flow.
