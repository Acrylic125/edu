# Types

## Ids

```ts
import { nanoid } from "nanoid"

export type TopicId = string
export type MessageId = string

export function clientMessageId(): MessageId {
  return nanoid()
}
```

`TopicId` is a server topic id. There is no separate `ChatId`. Optimistic user messages use `clientMessageId()`. Server message ids stay whatever the API and WS send.

## Catalog (no threads)

```ts
export type TopicListing = {
  id: TopicId
  title: string
  summary: string
  createdAt: string
  updatedAt: string
}

export type TopicCatalog = {
  byId: Record<TopicId, TopicListing>
  order: TopicId[]
}
```

`GET /topics` maps 1:1 into `TopicListing`. `order` is API order. Lookups go through `byId`. Listings never carry `messages`.

## Session (the only thread)

```ts
export type ChatMessageAttachment = {
  id: string
  name: string
  mimeType: string
  previewUrl: string
}

export type ChatMessage = {
  id: MessageId
  role: "user" | "assistant"
  parts: MessagePart[]
  attachments?: ChatMessageAttachment[]
  status?: "streaming" | "complete" | "cancelled"
  progress?: string[]
}

export type TopicHandoff = {
  topicId: TopicId
  title: string
}

export type ChatSession =
  | { kind: "none" }
  | {
      kind: "topic"
      topicId: TopicId
      title: string
      messages: ChatMessage[]
      handoff: TopicHandoff | null
    }
```

`kind: "none"` is a user with no current topic. Empty composer, no fake seed chat. `handoff` is set only when this session replaced another topic in the same page lifetime (WS `topicId` changed). It is not "the previous item in the catalog."

## Socket and run as facts, not UI

```ts
export type SocketFact =
  | { status: "boot" }
  | { status: "connecting" }
  | { status: "ready"; userId: string }
  | { status: "error"; message: string }

export type RunFact =
  | { status: "idle" }
  | { status: "running"; runId: string; messageId: MessageId }

export type Gate = "blocked" | "send" | "stop"
```

`boot` is the store right after RSC hydrate, before the hook has opened a socket. `connecting` is an open socket that has not sent `ready`, including `socket_closed` reconnect. Keep these as facts. UI does not read them except through `shellPhase` and `Gate`.

## Bootstrap payload (RSC → provider)

```ts
export type CurrentMessagesPayload = {
  topic: { id: TopicId; title: string } | null
  messages: ChatMessage[]
}

export type ChatBootstrap = {
  catalog: TopicCatalog
  session: ChatSession
}
```

`loadChatBootstrap(): Promise<ChatBootstrap>`

If current messages has a topic, session is `{ kind: "topic", topicId, title, messages, handoff: null }`. If `topic` is null, session is `{ kind: "none" }`. Catalog can be empty while session is `none`.

If current messages names a topic missing from `GET /topics`, `upsertListing` with `summary: ""` and the current timestamps omitted or copied from now on the client only after a later catalog refresh. Prefer inserting `{ id, title, summary: "", createdAt: "", updatedAt: "" }` as a stub listing so the dropdown has a selected row.

## Store

```ts
export type ChatStoreState = {
  catalog: TopicCatalog
  session: ChatSession
  socket: SocketFact
  run: RunFact
  switch: null | { topicId: TopicId }
  revealed: boolean
}

export type ChatStore = ChatStoreState & {
  applyWs: (message: WsServerMessage) => void
  applySocketClosed: () => void
  stageUserMessage: (
    messageId: MessageId,
    content: string,
    attachments: ChatMessageAttachment[]
  ) => void
  stopLocal: () => void
  beginSwitch: (topicId: TopicId) => void
  commitSwitch: (payload: CurrentMessagesPayload) => void
  failSwitch: (message: string) => void
  upsertListing: (listing: TopicListing) => void
  replaceCatalog: (catalog: TopicCatalog) => void
  sendGate: () => Gate
}
```

`switch` is a pending catalog select. It is not a boolean `isLoading`.

Zustand store type is `ChatStore`. Create with `createChatStore(bootstrap: ChatBootstrap)`. Initial `socket` is `"boot"`. Initial `run` is `"idle"`. Initial `switch` is `null`. Initial `revealed` is `false`.

## `shellPhase` (the UI discriminant)

```ts
export type ShellPhase =
  | {
      show: "skeleton"
      reason: "boot" | "connecting" | "switch"
    }
  | {
      show: "thread"
      topicId: TopicId | null
      title: string
      messages: ChatMessage[]
      empty: boolean
      handoff: TopicHandoff | null
    }
  | { show: "error"; message: string }

export function selectShellPhase(state: ChatStoreState): ShellPhase
```

Derivation (first match wins):

1. `socket.status === "error"` and there has never been a `ready` in this store lifetime → `{ show: "error", message }`
2. `switch !== null` → `{ show: "skeleton", reason: "switch" }`
3. `socket.status === "boot"` → `{ show: "skeleton", reason: "boot" }`
4. `socket.status === "connecting"` and `revealed === false` → `{ show: "skeleton", reason: "connecting" }`
5. Else `{ show: "thread", ... }` from `session` (`topicId`/`title` null/empty when `kind === "none"`)

`revealed` is store-private. Set true on the first `ready`. Socket close after reveal sets `socket` to `connecting` but does not flip `revealed` back. Header can still say Connecting. The thread stays mounted.

After a successful `commitSwitch`, keep `revealed` true. Switch skeleton is driven by `switch`, not by the socket.

Socket error after reveal: stay on `thread`, surface the error in the header. Do not blank the messages.

## WS events vs session

```ts
export type SessionEvent =
  | { type: "user_sent"; messageId: MessageId; content: string; attachments: ChatMessageAttachment[] }
  | { type: "ws"; message: WsServerMessage }
  | { type: "socket_closed" }
  | { type: "topic_born"; topicId: TopicId; previous: TopicHandoff }
```

`applyWs` may emit an internal `topic_born` when `message.topicId` is present and `session.kind === "topic"` and `message.topicId !== session.topicId`, or when `session.kind === "none"` and a `topicId` arrives.

On `topic_born`:

- set `handoff` to `previous`
- set session to the new `topicId` with `messages: []`
- drop in-flight run onto the new session only if the event also carries `messageId`/`runId`

Deltas for a `messageId` that is not in the (new) session are ignored, except `run.started` / `run.progress` / `run.ended` which may insert an assistant row.

`withTopic` that copies `messages` onto a new id does not exist.

## HTTP helpers

```ts
export function parseTopicsResponse(json: unknown): TopicCatalog
export function parseCurrentMessages(json: unknown): CurrentMessagesPayload

export function loadChatBootstrap(): Promise<ChatBootstrap>

export function fetchTopics(token: string): Promise<TopicCatalog>
export function fetchCurrentMessages(token: string): Promise<CurrentMessagesPayload>
export function postSelectTopic(token: string, topicId: TopicId): Promise<void>
```

Server loaders use `getSession()`. Client helpers take the bearer from `useSession()`. Zod schemas already live in `ws-schema.ts` for current messages. Add a `TopicsListSchema` next to them for `{ topics: Array<{ id, title, summary, createdAt, updatedAt }> }`.

## Send gate

```ts
export function sendGate(
  socket: SocketFact,
  run: RunFact,
  draft: string,
  hasAttachments: boolean,
  attachmentsReady: boolean
): Gate
```

`blocked` unless `socket.status === "ready"`. `stop` when `run.status === "running"`. Else same empty-draft / attachments rules as today's `sendAffordance`. Composer maps `blocked` → disabled, `stop` → stop, `send` → send.

## Header

```ts
export function headerStatus(state: ChatStoreState): {
  label: string
  tone: "muted" | "destructive"
}
```

Connecting for `boot` and `connecting`. Error message for `error`. Working… for `run.running`. Online otherwise. This is independent of `shellPhase.show`. The header can say Connecting while the thread is already visible on reconnect.
