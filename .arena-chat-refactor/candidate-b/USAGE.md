# Usage

Callers never hold a `chats[]`. They read a topic catalog, a single live session, and one `shellPhase`. The page is a server component. Zustand lives only inside client islands.

## Page (RSC)

```tsx
// web/app/(app)/page.tsx
import { Suspense } from "react"
import { ChatFrame } from "@/components/chat/chat-frame"
import { MessageSkeletons } from "@/components/chat/message-skeletons"
import { loadChatBootstrap } from "@/lib/chat/load-bootstrap"
import { ChatApp } from "@/components/chat/chat-app"

export default function Home() {
  return (
    <Suspense
      fallback={
        <ChatFrame
          title="Chat"
          status="Connecting"
          body={<MessageSkeletons />}
        />
      }
    >
      <BootedChat />
    </Suspense>
  )
}

async function BootedChat() {
  const bootstrap = await loadChatBootstrap()
  return <ChatApp bootstrap={bootstrap} />
}
```

`ChatFrame` is a server component. Header, main column, composer slot. The Suspense fallback and the live app share that chrome so hydrate does not swap layout.

`loadChatBootstrap` runs both reads with the session bearer token, `cache: "no-store"`:

- `GET /topics` → catalog listings
- `GET /topics/current/messages` → current topic + thread, or `{ topic: null, messages: [] }`

Failures (no session, non-OK, zod miss) become an empty catalog and a `session.kind === "none"` thread. Do not invent a fake "New chat" row.

## Hydrate the store once

```tsx
// web/components/chat/chat-app.tsx
"use client"

import { ChatStoreProvider } from "@/lib/chat/store"
import { ChatSocketIsland } from "@/components/chat/chat-socket-island"
import { ChatThreadIsland } from "@/components/chat/chat-thread-island"
import { ChatComposerIsland } from "@/components/chat/chat-composer-island"
import { ChatFrame } from "@/components/chat/chat-frame"

export function ChatApp({ bootstrap }: { bootstrap: ChatBootstrap }) {
  return (
    <ChatStoreProvider bootstrap={bootstrap}>
      <ChatSocketIsland />
      <ChatFrame
        titleSlot={<HeaderTitle />}
        statusSlot={<HeaderStatus />}
        body={
          <>
            <PreviousTopicBar />
            <ChatThreadIsland />
          </>
        }
        composer={<ChatComposerIsland />}
      />
    </ChatStoreProvider>
  )
}
```

`ChatStoreProvider` calls `createChatStore(bootstrap)` and puts the store on context. Do not use a module-level `create()`. A refresh from RSC must replace the store, not merge into a leftover singleton.

`ChatSocketIsland` renders nothing. It owns `useChatWebSocket` and dispatches parsed WS events into the store.

## Read `shellPhase`, not loading flags

```tsx
"use client"

import { useChatStore, selectShellPhase } from "@/lib/chat/store"

export function ChatThreadIsland() {
  const phase = useChatStore(selectShellPhase)

  if (phase.show === "skeleton") {
    return <MessageSkeletons />
  }
  if (phase.show === "error") {
    return <p className="text-destructive text-sm">{phase.message}</p>
  }
  if (phase.empty) {
    return null // empty-state copy stays in ChatFrame around the composer
  }
  return <MessageList messages={phase.messages} />
}
```

`selectShellPhase` is the only branch the thread UI needs. There is no `isLoading && isConnecting`. Skeleton covers first paint (Suspense fallback already did) and the wait until the socket has seen `ready`. After the thread has been revealed, a later reconnect stays on `show: "thread"`. Topic switch goes back to skeleton until `GET /topics/current/messages` returns.

## Send a user message

```ts
import { nanoid } from "nanoid"
import { useChatStore } from "@/lib/chat/store"
import { WsChatClientMessageSchema } from "@/lib/chat/ws-schema"

function send(content: string, attachments: ChatMessageAttachment[]) {
  const store = useChatStore.getState()
  if (store.sendGate() !== "send") {
    return
  }
  const messageId = nanoid()
  store.stageUserMessage(messageId, content, attachments)
  sendJsonMessage(
    WsChatClientMessageSchema.parse({
      type: "message",
      message: messageId,
      parts: toClientParts(content, attachments),
    })
  )
}
```

Client ids come from `nanoid()`, never `crypto.randomUUID()`. Stage locally first so the optimistic user bubble exists before `run.started`.

## In-session topic create

Do not remap the current session id onto the new topic while keeping the old thread.

When a `run.started` or `run.ended` `topicId` is set and it is not `session.topicId`:

1. Copy `{ id, title }` from the current session into `handoff`.
2. Replace the session with `{ kind: "topic", topicId, messages: [] }`, then apply only events for that new id.
3. `upsertListing` the new id (title may be `"New chat"` until `GET /topics` returns).
4. Kick `refreshCatalog()`.

The thread is now empty for the new topic. The top bar renders:

`Change to Previous Topic, "{handoff.title}"`

Clicking it is the same path as picking that row in the composer menu: `POST /topics/:id/select`, then reload current messages, then clear `handoff`.

## Composer topic menu

The composer bottom bar mounts a `dropdown-menu` over `selectCatalog(store)`.

```tsx
<DropdownMenu>
  <DropdownMenuTrigger>{currentTitle ?? "Topics"}</DropdownMenuTrigger>
  <DropdownMenuContent>
    {listings.map((topic) => (
      <DropdownMenuItem
        key={topic.id}
        disabled={topic.id === currentId}
        onClick={() => void switchTopic(topic.id)}
      >
        {topic.title}
      </DropdownMenuItem>
    ))}
  </DropdownMenuContent>
</DropdownMenu>
```

`switchTopic` is the only write path that changes which thread is on screen besides WS topic birth:

```ts
async function switchTopic(topicId: TopicId) {
  const store = useChatStore.getState()
  store.beginSwitch(topicId)
  await postSelect(topicId) // POST /topics/:id/select
  const snapshot = await getCurrentMessages() // GET /topics/current/messages
  store.commitSwitch(snapshot)
}
```

The open websocket stays up. The Durable Object reads `getCurrentTopic` per turn, so select is enough. Do not reconnect to "bind" the topic.

## What callers must not do

- Do not keep a parallel `useState<ChatUiState>`.
- Do not render `chat.messages` from a catalog row. Catalog rows have no messages.
- Do not show a previous-topic button because the catalog has more than one entry. The button is only for `handoff`.
- Do not pass `connection` and `activity` into the thread to decide skeleton vs list. Pass `shellPhase`.
