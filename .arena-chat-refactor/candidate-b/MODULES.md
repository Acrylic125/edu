# Modules

Layout follows the store split. Catalog HTTP, session reduce, and the socket island do not share a `Chat` type.

## Keep

| Path | Role |
| --- | --- |
| `web/lib/chat/ws-schema.ts` | Zod for WS and `CurrentTopicMessagesSchema`. Add `TopicsListSchema` here. |
| `web/lib/chat/ws.ts` | URL + `useChatWebSocket`. Unchanged options (`share: false`). |
| `web/lib/chat/composer-images.ts` | Local draft images. Unchanged. |
| `web/lib/chat/upload-asset.ts` | Upload URLs. Unchanged. |
| `web/components/ui/dropdown-menu.tsx` | Composer topic picker. |
| `web/components/chat/message-list.tsx` | Renders `ChatMessage[]` only. No catalog, no connection. |
| `web/components/chat/chat-composer.tsx` | Draft, images, send/stop. Gains a bottom-bar slot for the topic menu. Drops `ChatConnection`/`ChatActivity` props in favor of `Gate` + `onSend`/`onStop`. |

## Replace

| Path | Role |
| --- | --- |
| `web/lib/chat/types.ts` | Delete `Chat`, `ChatId`, `ChatUiState`. Export catalog, session, socket, run, bootstrap, `ShellPhase`. |
| `web/lib/chat/state.ts` | Delete `chats[]` reduce, `createChat`, `selectChat`, `getActiveChat`, `withTopic`. Split into the files below. |
| `web/lib/chat/seed.ts` | Delete. Empty state is `session.kind === "none"`, not a seeded chat. |
| `web/lib/chat/load-topic-snapshot.ts` | Replace with `load-bootstrap.ts`. |
| `web/app/(app)/page.tsx` | Suspense fallback is `ChatFrame` + `MessageSkeletons`, not a centered "Loading chat…". |
| `web/components/chat/chat-workspace.tsx` | Split into provider, socket island, thread island. |
| `web/components/chat/chat-main.tsx` | Chrome moves to `chat-frame.tsx`. Thread body reads `shellPhase`. |

## New lib

**`web/lib/chat/ids.ts`**

`clientMessageId()` via `nanoid`. Only the send path imports this.

**`web/lib/chat/catalog.ts`**

`emptyCatalog()`, `catalogFromTopics()`, `upsertListing()`, `listingOf()`. Pure. No messages.

**`web/lib/chat/session-reduce.ts`**

`reduceSession(session, run, event) → { session, run }`. Handles `user_sent`, WS run events, `topic_born`. Ignores deltas when `session.kind === "none"` until a `topicId` arrives. Title updates: if `kind === "topic"` and title is still the placeholder and the user sent text, set title from content (same 40-char clip as today).

**`web/lib/chat/shell-phase.ts`**

`selectShellPhase(state)`. No React. Test this file hard. If a component needs a boolean, it is probably violating the discriminant.

**`web/lib/chat/gate.ts`**

`sendGate(...)`. Moved out of `state.ts`.

**`web/lib/chat/http.ts`**

Browser `fetchTopics`, `fetchCurrentMessages`, `postSelectTopic`. Shared URL builders with the server loader. Not a wrapper around the store.

**`web/lib/chat/load-bootstrap.ts`**

Server-only. `getSession`, parallel `GET /topics` and `GET /topics/current/messages`, zod, map to `ChatBootstrap`.

**`web/lib/chat/store.ts`**

`createChatStore`, `ChatStoreProvider`, `useChatStore`. Zustand. Actions call `reduceSession` and catalog helpers. `applyWs` is the socket island's only entry. `beginSwitch` / `commitSwitch` / `failSwitch` are the HTTP island's only entry.

Do not export a `ChatUiState` compatibility layer.

**`web/lib/chat/map-message.ts`**

`toChatMessage(ResponseMessage)` currently in `load-topic-snapshot.ts`. Shared by bootstrap and `commitSwitch`.

## New components

**`web/components/chat/chat-frame.tsx`**

Server component. `h-dvh` column, header row (title slot, status slot, `AccountMenu`), main, composer slot. Used by the Suspense fallback and by `ChatApp`. Fallback passes string title `"Chat"`, status `"Connecting"`, body `<MessageSkeletons />`, composer a disabled-looking static bar or the same skeleton block so height does not jump.

**`web/components/chat/message-skeletons.tsx`**

Server component. A few left/right bars in the same padding as `MessageList`. Same tree for hydrate fallback, `shellPhase.show === "skeleton"`.

**`web/components/chat/chat-store-provider.tsx`**

Can live in `store.ts` if it stays small. `useState(() => createChatStore(bootstrap))` once.

**`web/components/chat/chat-socket-island.tsx`**

Client. Session token → socket URL. `onMessage` parse with `WsServerMessageSchema`, `applyWs`. `onClose` → `applySocketClosed`. Same parse-fail behavior as today: `run.ended` / `error` still `stopLocal()`.

**`web/components/chat/chat-thread-island.tsx`**

Client. `selectShellPhase`. Skeleton, error, or `MessageList`. Empty thread shows nothing in the list layer. The centered "New chat / Send a message" copy stays in the frame overlay, same as `chat-main.tsx` today, gated on `phase.show === "thread" && phase.empty`.

**`web/components/chat/previous-topic-bar.tsx`**

Client. Renders only when `phase.show === "thread" && phase.handoff`. Label exactly `Change to Previous Topic, "{title}"`. Click → `switchTopic(handoff.topicId)`.

**`web/components/chat/topic-menu.tsx`**

Client. Composer bottom bar. Dropdown over `catalog.order`. Current topic checked. `onSelect` → `switchTopic`. Hidden or disabled when catalog `order.length === 0` and session is `none`.

**`web/components/chat/chat-app.tsx`**

Client root island. Provider + frame slots + socket island.

**`web/components/chat/use-switch-topic.ts`**

Client helper used by the bar and the menu. `beginSwitch`, POST select, GET current messages, `commitSwitch`, `replaceCatalog` optional refresh. On failure `failSwitch`.

## Delete / stop using

- `createChat` / `selectChat` / sidebar chat list, if any leftover
- `initialChatUiState`
- `crypto.randomUUID` in composer and workspace send paths
- Mapping `chat.id = topicId` in place

## Deps

Add to `web/package.json` (pnpm): `nanoid`, `zustand`. Backend already has `nanoid`. Do not add a UUID package.

## Data flow

```
RSC page
  loadChatBootstrap
    GET /topics
    GET /topics/current/messages
  ChatApp(bootstrap)
    Zustand
    ChatSocketIsland ── WS ── applyWs ── session-reduce
    TopicMenu / PreviousTopicBar
      POST /topics/:id/select
      GET /topics/current/messages
      commitSwitch
    ChatThreadIsland ── selectShellPhase
```

WS never writes the catalog except `upsertListing` on `topic_born`. Catalog refresh is HTTP.
