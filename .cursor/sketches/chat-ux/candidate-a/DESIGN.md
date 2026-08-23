# Candidate A. Parts-first chat, DO-owned run

Organizing structure. A client reducer over a discriminated connection/composer machine, plus a Durable Object run machine that is the only writer of assistant text. Messages stay as `parts` everywhere. Flattening to `content: string` is the bug that made streaming, markdown, options, and history all fight each other.

## Problem

Five defects, one model.

Streaming never existed. `ChatDurableObject` awaits `handleChat` and fires one `{type:"response"}`. `callLlm` is invoke-only. `applyChatResponse` appends whole messages. Generated text must flush every 8 complete words, or when that part is done.

Assistant text is `whitespace-pre-wrap`. `react-markdown`, `katex`, `remark-math`, `rehype-katex` sit unused. User bubbles stay skill-chip text.

Fresh load starts from `initialChatUiState` with empty messages. Rows live in D1 `topic_message`. GET `/topics` has no messages. `loadRecentMessages` is capped at 8 for the agent, not the UI. The current topic's full history must load in a server component behind Suspense.

`composerDisabled` is connecting OR busy, and that disables the textarea. Type anytime. Submit only when the socket is ready. While a run is in flight, send becomes Stop, and Stop aborts the run.

Intent is guessed then executed. No topic auto-creates. `executeUpdateTopic` skips confirm when the message is non-empty. `parseJsonFromLlm` invents title/summary/question. Do not assume unless the user typed `/new`, `/update`, `/ans`, `/new-qns`, or `/topic`. Inferred actions wait for an explicit confirm.

## Usage (caller's view)

History is a server snapshot. The workspace is a reducer. The socket is a parsed event source. Nothing in React fetches chat.

```tsx
// web/app/(app)/page.tsx
import { Suspense } from "react"
import { ChatWorkspace } from "@/components/chat/chat-workspace"
import { loadCurrentTopicSnapshot } from "@/lib/chat/load-topic-snapshot"
import { emptyChatSnapshot } from "@/lib/chat/seed"

export default function Home() {
  return (
    <Suspense fallback={<ChatWorkspace snapshot={emptyChatSnapshot} />}>
      <CurrentTopicChat />
    </Suspense>
  )
}

async function CurrentTopicChat() {
  const snapshot = await loadCurrentTopicSnapshot()
  return <ChatWorkspace snapshot={snapshot} />
}
```

```ts
// web/lib/chat/load-topic-snapshot.ts
// getSession is cached in layout. Bearer token is session.session.token.
// NEXT_PUBLIC_API_URL is the worker.

export async function loadCurrentTopicSnapshot() {
  const session = await getSession()
  if (!session) {
    throw new Error("Not authenticated")
  }

  const url = new URL("/topics/current/messages", env.NEXT_PUBLIC_API_URL)
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.session.token}`,
    },
    cache: "no-store",
  })
  const json = await response.json()
  return TopicSnapshotSchema.parse(json)
}
```

Send, stop, and option clicks are the only client writes that leave the browser.

```tsx
// ChatWorkspace. Real call site.

function handleSend(content: string, attachments: ChatMessageAttachment[]) {
  if (state.connection.status !== "ready") {
    return
  }
  const messageId = crypto.randomUUID()
  setState((current) =>
    reduceChat(current, {
      type: "user_sent",
      messageId,
      content,
      attachments,
      userId: session.data.user.id,
    })
  )
  sendJsonMessage(
    WsChatClientMessageSchema.parse({
      type: "message",
      message: messageId,
      parts: [{ type: "text", content: content.trim() }],
    })
  )
}

function handleStop() {
  if (state.connection.status !== "running") {
    return
  }
  sendJsonMessage(
    WsChatClientStopSchema.parse({
      type: "stop",
      runId: state.connection.runId,
    })
  )
}

function handleChoice(value: string) {
  if (state.connection.status !== "ready") {
    return
  }
  const messageId = crypto.randomUUID()
  setState((current) =>
    reduceChat(current, {
      type: "user_sent",
      messageId,
      content: value,
      attachments: [],
      userId: session.data.user.id,
    })
  )
  sendJsonMessage(
    WsChatClientChoiceSchema.parse({
      type: "choice",
      message: messageId,
      value,
    })
  )
}
```

Socket handler stays one parse at the boundary.

```tsx
onMessage: (event) => {
  const parsed = WsServerMessageSchema.safeParse(JSON.parse(event.data))
  if (!parsed.success) {
    return
  }
  setState((current) => reduceChat(current, { type: "ws", message: parsed.data }))
}
```

Composer never takes `disabled` for the textarea. It takes a submit mode derived from connection.

```tsx
<ChatComposer
  submit={composerSubmit(state.connection)}
  onSend={handleSend}
  onStop={handleStop}
/>
```

```ts
function composerSubmit(connection: ChatConnection) {
  if (connection.status === "connecting") {
    return { mode: "blocked" as const }
  }
  if (connection.status === "running") {
    return { mode: "stop" as const, runId: connection.runId }
  }
  if (connection.status === "error") {
    return { mode: "blocked" as const }
  }
  return { mode: "send" as const }
}
```

Visible LLM text is the only stream. Intent JSON and topic JSON stay invoke.

```ts
// backend. handleChat / executeNewQuestion / welcome / verification prose

await streamVisibleText(runner, {
  name: "generate_question",
  instructions,
  input,
  messageId,
  partIndex: 0,
  sink,
  signal,
})
```

Markdown is a presentational leaf. User rows do not go through it.

```tsx
<ReactMarkdown
  remarkPlugins={mathPlugins}
  rehypePlugins={mathRehype}
  components={chatMarkdownComponents}
>
  {text}
</ReactMarkdown>
```

`chatMarkdownComponents` is the itsme profile-chat map (p, lists, links, code, pre, headings, blockquote) plus a `span` for KaTeX. Copy the Tailwind classes. Do not grow a markdown framework.

## Shape

### Who writes what

| Event | Client reducer | Durable Object |
| --- | --- | --- |
| User send | Inserts the user message, sets connection to `running` with a provisional runId of `pending` until `run.started` | Persists the user row with the client id, creates the agent run, broadcasts `run.started` |
| Assistant delta | Patches the streaming agent message | Only writer of assistant text. Buffers words, sends `run.delta` |
| `run.ended` | Replaces the streaming message with persisted parts, sets connection `ready` | Persists complete parts once, then sends `run.ended` with those parts |
| Stop | Does not invent an aborted bubble. Waits for `run.aborted` | Aborts the LLM, persists whatever text existed, sends `run.aborted` |
| Both would write the same agent message | Client never assigns agent content. If `run.ended` arrives for an id the client already streamed, replace in place. If a history snapshot already has that id, ignore the stream insert and only patch if `status` is streaming | |

Reconnect. Run state is on the DO (`ctx.storage` plus in-memory `AbortController`), not only on the websocket attachment. A new socket for the same user gets `run.started` (or a compact `run.catchup`) if a run is live, then further deltas. `agentRunning` on the attachment is derived from storage, not the source of truth.

### Connection and composer. No optional bags

```ts
type ChatConnection =
  | { status: "connecting" }
  | { status: "ready"; userId: string }
  | { status: "running"; userId: string; runId: string }
  | { status: "error"; message: string }
```

Drop `busy`. "Agent is already running" from a second overlapping `message` is still `running` on the socket that owns the run. The other socket is also `running` after catchup. A stray `message` while running is ignored by the DO except `stop`.

```ts
type ComposerSubmit =
  | { mode: "send" }
  | { mode: "stop"; runId: string }
  | { mode: "blocked" }
```

Textarea is never disabled. Paperclip stays enabled. Submit button. `send` enabled when draft or images exist. `stop` always enabled. `blocked` looks like send but does not submit (connecting or error).

Enter. Same rules as the button. Enter during `running` does not send and does not stop.

### Messages keep parts

```ts
type ChatMessage =
  | {
      id: string
      role: "user"
      parts: MessagePart[]
      attachments?: ChatMessageAttachment[]
    }
  | {
      id: string
      role: "assistant"
      parts: MessagePart[]
      status: "streaming" | "complete" | "aborted"
    }
```

`MessagePart` stays the existing discriminated union in `ws-schema.ts` / `messages/schema.ts`. Add one variant for a machine choice, used when the user clicks a confirmation chip.

```ts
export const ChoicePartSchema = z.object({
  type: z.literal("choice"),
  value: z.string(),
})
```

Extend `OptionItemSchema` with a stable `value` so confirmations are not regexed out of English.

```ts
export const OptionItemSchema = z.object({
  label: z.string(),
  value: z.string(),
})
```

UI `ChatMessage` is not a wire type. History HTTP and WS parse with zod, then `toUiMessage` (one function) maps `role: "agent"` to assistant and sets `status: "complete"`.

### Wire protocol. Extend the duplicated zod files

The two schema files are copies. There is no shared package. This redesign extends both in lockstep. Backend `backend/edu-api/src/messages/schema.ts` is canonical. `web/lib/chat/ws-schema.ts` must match. A later `packages/chat-protocol` is the real fix. Do not invent a third copy in `types.ts`.

Replace the terminal-only `response` with a run sequence. Keep `ready` and `error`. Remove `busy` as a connection mode. A late overlapping send can still get `{type:"error", message:"Agent is already running."}` if we do not want silent drop. Prefer silent drop of `message` while running, accept `stop`.

```ts
export const WsChatClientStopSchema = z.object({
  type: z.literal("stop"),
  runId: z.string(),
})

export const WsChatClientChoiceSchema = z.object({
  type: z.literal("choice"),
  message: z.string(),
  value: z.string(),
})

export const WsChatClientEnvelopeSchema = z.discriminatedUnion("type", [
  WsChatClientMessageSchema,
  WsChatClientStopSchema,
  WsChatClientChoiceSchema,
])

export const WsRunStartedSchema = z.object({
  type: z.literal("run.started"),
  runId: z.string(),
  messageId: z.string(),
  topicId: z.string().optional(),
})

export const WsRunDeltaSchema = z.object({
  type: z.literal("run.delta"),
  runId: z.string(),
  messageId: z.string(),
  partIndex: z.number().int().nonnegative(),
  text: z.string().min(1),
})

export const WsRunEndedSchema = z.object({
  type: z.literal("run.ended"),
  runId: z.string(),
  messageId: z.string(),
  parts: MessagePartsSchema,
  topicId: z.string().optional(),
})

export const WsRunAbortedSchema = z.object({
  type: z.literal("run.aborted"),
  runId: z.string(),
  messageId: z.string(),
  parts: MessagePartsSchema,
})
```

`WsServerMessageSchema` becomes ready | error | run.started | run.delta | run.ended | run.aborted.

HTTP snapshot.

```ts
export const TopicSnapshotSchema = z.object({
  topic: z
    .object({
      id: z.string(),
      title: z.string(),
    })
    .nullable(),
  messages: z.array(ResponseMessageSchema),
})
```

GET `/topics/current/messages`. `requireUser`. `getCurrentTopic`. If none, `{topic: null, messages: []}`. If present, `loadAllMessages(topicId)` ordered by `createdAt` ascending. No limit. Parse each row with existing `PersistedTopicMessageSchema`.

### Pure functions

Word buffer. Completeness is trailing whitespace. Tokens are `\S+`. Flush when 8 complete tokens are waiting, or on `flush()`.

```ts
export type WordBuffer = {
  emitted: string
  hold: string
}

export function emptyWordBuffer() {
  return { emitted: "", hold: "" }
}

export function pushWords(buffer: WordBuffer, chunk: string, wordLimit = 8) {
  // not implemented. Append chunk onto hold.
  // Split hold into complete tokens (separated by whitespace) plus a remainder
  // that has no trailing whitespace.
  // While complete token count >= wordLimit, move the next wordLimit tokens
  // (and the whitespace that followed them) into a flush string.
  // Return { buffer, flush } where flush is "" when nothing should send yet.
}

export function flushWords(buffer: WordBuffer) {
  // not implemented. Send hold even if fewer than 8 words. Clear hold.
}
```

Reducer. One function, one event union. No useEffect sync.

```ts
type ChatEvent =
  | {
      type: "user_sent"
      messageId: string
      content: string
      attachments: ChatMessageAttachment[]
      userId: string
    }
  | { type: "ws"; message: WsServerMessage }
  | { type: "socket_closed" }

export function reduceChat(state: ChatUiState, event: ChatEvent) {
  // not implemented.
  // user_sent. Append user ChatMessage. Connection becomes running with runId "pending".
  // ws run.started. Replace pending runId. Insert assistant {status:"streaming", parts:[{type:"text", content:""}]}.
  // ws run.delta. Append text onto parts[partIndex] if it is text. Create the text part if missing.
  // ws run.ended. Set parts from wire, status complete, connection ready, set topicId.
  // ws run.aborted. Set parts, status aborted, connection ready.
  // ws ready. Connecting or error -> ready. Do not clobber running.
  // ws error. Connection error. If a streaming assistant exists, leave it aborted locally only after run.aborted.
  // socket_closed. Connecting. Keep messages.
}
```

Intent. Explicit vs inferred is a union, not a boolean on the old type.

```ts
export type IntentType =
  | "new-topic"
  | "update-topic"
  | "answer"
  | "new-question"

export type ChatIntent =
  | { kind: "explicit"; type: IntentType; message: string }
  | { kind: "inferred"; type: IntentType; message: string }
  | { kind: "undirected"; message: string }
```

```ts
export function parseExplicitCommand(message: string): Extract<ChatIntent, { kind: "explicit" }> | null
export async function classifyIntent(...): Promise<Exclude<ChatIntent, { kind: "explicit" }>>
```

`deduceIntent` today collapses those. Split. `handleChat` never calls `dispatchIntent` on `inferred` or `undirected`.

JSON from the model. Kill inventing fallbacks.

```ts
export function parseJsonFromLlm<T extends z.ZodType>(schema: T, response: string) {
  // not implemented. Extract JSON object, schema.safeParse.
  // On failure return { ok: false as const }. No fallback argument.
}
```

If `/new` JSON fails, stream an agent error part and do not create a topic.

### Confirmation flow

Pending action is one row in `agent_step` named `pending_action`, same pattern as today's `pending_topic_update`, but for every inferred action.

```ts
export const PendingActionSchema = z.object({
  type: z.enum(["new-topic", "update-topic", "answer", "new-question"]),
  message: z.string(),
})
```

No current topic.

1. User text is not an explicit command.
2. Do not create a topic.
3. Persist an agent message. Text asks whether to start a topic. Options `{label: "Start this topic", value: "confirm"}` and `{label: "Not now", value: "reject"}`.
4. Record `pending_action` `{type:"new-topic", message}`.
5. Stream that text through the word buffer. Options attach on `run.ended`, not mid-stream.

Inferred while a topic exists.

- `new-topic`. Confirm before `createTopic` / `setCurrentTopic`.
- `update-topic`. Always confirm. Delete `applyUpdateDirect`. `/update` with a non-empty body still proposes, then waits. `/update` does not write the plan until confirm.
- `new-question`. Confirm "Generate a practice question?" before `executeNewQuestion`.
- `answer`. Confirm "Grade this as an answer" vs "Treat this as a question". Do not call `identify_question` with a fallback `{found:true, question: raw}`. If JSON fails, ask. If `found` is false, ask. If several candidates, options whose `value` is the candidate index, still a confirm, not a silent pick.

Choice handling, before classify.

1. Load latest `pending_action` for the topic.
2. If `value === "reject"`, clear pending, persist "Okay, what instead?", done.
3. If `value === "confirm"` (or a candidate value), `dispatchIntent` with `{kind:"explicit", type, message}` using the stored payload, then clear pending.

Plain text "yes" is not a confirm. Only a `choice` envelope or a later explicit slash command. That is the point of not assuming.

`/topic` stays an explicit answer-path command, as today.

### Stop / abort

DO fields (memory).

```ts
currentAbort: AbortController | null
currentRunId: string | null
currentMessageId: string | null
```

Storage. `{runId, messageId, userId, startedAt}`.

`webSocketMessage` for `stop`.

1. Parse `WsChatClientStopSchema`.
2. If `runId` does not match storage, ignore.
3. `currentAbort.abort()`.
4. `callLlm` / `streamVisibleText` take `signal` and pass it into LangChain `chat.stream(..., { signal })`.
5. Catch abort. Persist parts gathered so far (maybe empty text). `runner.fail("aborted")`. Broadcast `run.aborted`. Clear storage. `agentRunning` false.

Do not persist streaming rows. Only the final or aborted snapshot, same as today.

Hibernation. The isolate stays awake during `await handleChat`. AbortController does not need to live in `serializeAttachment`. After a hard DO restart mid-run, storage may still say running with a dead controller. On `fetch` / first message, if storage is running but `currentAbort` is null, mark the run failed, persist an aborted stub if the agent message was never written, broadcast error, clear storage.

### Streaming which calls

Stream to the sink. Welcome text, practice question text, verification feedback, confirmation prose, generic agent sentences.

Do not stream. `infer_intent`, topic JSON, update JSON, question identification JSON.

`AgentRunner.llmCall` stays invoke. Add `AgentRunner.llmStream` that records the step, streams tokens into `pushWords`, writes step output at the end.

Sink lives in `do/chat.ts` and is passed into `handleChat`. That keeps the send path at three files.

Send. `chat-workspace.tsx` → `do/chat.ts` → `chat/route.ts`.

Stream flush. `agents/llm.ts` → `chat/word-buffer.ts` → `do/chat.ts` (`sink.sendDelta`).

### Markdown

`web/components/chat/assistant-markdown.tsx`. Client component. Import `katex/dist/katex.min.css` once here.

While `status === "streaming"`, render markdown without `remark-math` / `rehype-katex` so a half-written `$` does not explode. On `complete` or `aborted`, turn math on.

Options render under the markdown as buttons. They call `onChoice(option.value)`. Do not stringify options through `partsToText` in the UI. Keep `partsToText` for the model.

### History fetch

Auth. App layout already `getSession()` + redirect. `loadCurrentTopicSnapshot` calls the same cached `getSession()`. Worker `requireUser` already lifts `?token=` or `Authorization` via the bearer plugin.

Do not read D1 from Next. Next has its own drizzle for auth. Messages stay on the worker.

`ChatWorkspace` takes `snapshot`. `useState(() => snapshotToUiState(snapshot))`. Connection still starts as `connecting` until WS `ready`. Messages from the snapshot are complete assistant/user rows.

Empty topic. One local chat titled from the topic or `"New chat"`, `messages: []`, no `topicId`.

### Module map

| File | Change |
| --- | --- |
| `web/app/(app)/page.tsx` | Suspense + server child that loads snapshot |
| `web/lib/chat/load-topic-snapshot.ts` | **new.** fetch + zod |
| `web/lib/chat/seed.ts` | `emptyChatSnapshot`, `snapshotToUiState` |
| `web/lib/chat/types.ts` | parts-based `ChatMessage`, new `ChatConnection` |
| `web/lib/chat/state.ts` | `reduceChat`, drop `applyChatResponse` flatten |
| `web/lib/chat/ws-schema.ts` | run events, stop, choice, snapshot, option `value`, choice part |
| `web/components/chat/chat-workspace.tsx` | snapshot prop, stop, choice, no composerDisabled |
| `web/components/chat/chat-main.tsx` | pass submit mode, `onStop`, `onChoice` |
| `web/components/chat/chat-composer.tsx` | never disable textarea, Stop vs Send |
| `web/components/chat/message-list.tsx` | user skill text, assistant markdown, option buttons |
| `web/components/chat/assistant-markdown.tsx` | **new.** itsme components + katex |
| `backend/edu-api/src/messages/schema.ts` | same wire schemas as web |
| `backend/edu-api/src/index.ts` | GET `/topics/current/messages` |
| `backend/edu-api/src/messages/persistence.ts` | `loadAllMessages` |
| `backend/edu-api/src/do/chat.ts` | parse envelope, sink, abort, storage run, broadcast |
| `backend/edu-api/src/agents/llm.ts` | `streamLlm` with signal |
| `backend/edu-api/src/agents/runner.ts` | `llmStream` |
| `backend/edu-api/src/chat/word-buffer.ts` | **new.** pure buffer |
| `backend/edu-api/src/chat/route.ts` | no auto topic, sink, confirm-first |
| `backend/edu-api/src/chat/intent.ts` | explicit vs inferred union |
| `backend/edu-api/src/chat/update-topic.ts` | delete `applyUpdateDirect` |
| `backend/edu-api/src/agents/parsed-output.ts` | `parseJsonFromLlm` without fallback |
| `backend/edu-api/src/chat/answer.ts` | no invented question |
| `web/lib/chat/skills.ts` | chips for update, ans, new-qns, topic (optional, same pattern as `/new`) |

Sidebar stays unwired. One current topic per user is still the product.

### `ChatUiState`

```ts
export type Chat = {
  id: ChatId
  title: string
  messages: ChatMessage[]
  topicId?: string
}

export type ChatUiState = {
  chats: Chat[]
  activeChatId: ChatId | null
  connection: ChatConnection
}
```

Keep the existing chat list shape so the unused sidebar still typechecks. Runtime is one active chat hydrated from the snapshot.

## Synthesis decision

pending parent synthesis

## Tradeoffs accepted

Word-count flushes, not tokens or time. Uneven cadence. Matches the requirement and stays a pure function.

Assistant markdown is a small component map, not a complete CommonMark suite. Tables and footnotes will look plain. Fine for this app.

Math plugins only after the part completes. Mid-stream formulas stay raw `$...$` until the flush that ends the part.

Confirmations add a turn. Explicit slash commands stay one-shot. Power users type `/ans`. Everyone else is slower and not silently re-routed.

Stop persists partial text. History can show a chopped sentence. Better than a phantom full answer or a vanished bubble.

Two zod files remain duplicated during this work. Shared package is a repo layout change, not a chat UX change.

No streaming rows in D1. Refresh during a run can miss in-flight text until `run.catchup` on WS. The snapshot is durable messages only.

`choice` is a new client envelope. Clicking an option does not go through the composer draft. The transcript still gets a user row whose text is the label.

## Alternatives considered

**SSE from the worker, keep WS for send.** Rejected. The DO already holds the socket and the run. A second channel means two auth paths and two catchup stories.

**Keep flattened `content: string` and stream by concatenating.** Rejected. Options and attachments would keep being smashed by `partsToText`. Markdown would have to re-parse a string that is not the storage model.

**Execute inferred intent, then show an undo.** Rejected. Topic create and plan update are not cleanly undoable once `user_current_topic` moved. The requirement is verify before any action.

**Client-side abort only (ignore the LLM, lock the composer).** Rejected. The DO would keep running and later persist a full answer the UI threw away. Stop has to abort the run.

**Offset pagination for history.** Rejected. The requirement is all messages for the current topic on first paint. Topics are tutoring threads, not infinite logs. If a thread ever blows past a few hundred rows, add cursor pagination then, not now.

## Open questions and risks

LangChain `ChatOpenAI.stream` on Workers with OpenRouter. If `signal` is ignored, Stop cancels our loop but the provider may keep billing. Need a spike on abort propagation.

DO broadcast to multiple tabs. Two browsers on the same user share one DO name. Both should see one run. Untested today.

`runId: "pending"` on the client for the gap between send and `run.started`. If `run.started` never arrives, Stop has nothing to send. Time out to `error` after a bounded wait in the reducer? That wait is not `Date.now()` inside a Convex query. It would be a client timer, which is a rare `useEffect`. Prefer deriving error from WS `error` only, and leave Stop disabled until `running` with a real runId. Composer stays in `stop` mode during `running` with `pending` but `onStop` no-ops until the real id exists. Awkward. Better. Keep the button as Stop but `onStop` only fires when `runId !== "pending"`.

Attachment parts on send are not in the current WS client payload (text only). Out of scope unless we already persist them. Do not pretend images reach the agent.

`parseJsonFromLlm` without fallback will fail more often. That is desired. Watch `/new` reliability.

## Next implementation step

Wire the protocol and the reducer first, with invoke-only LLM still sending a single `run.started` + `run.ended` (no deltas). Hydrate history. Unlock the composer. Then cut `streamLlm` and the word buffer. Then flip intent to confirm-first and delete `applyUpdateDirect` plus JSON fallbacks. Markdown last, because it only needs `parts` text on complete messages.
