# Rationale

The current model is a list of chats that happens to hold one active chat. `withTopic` then rewrites that chat's id to a new topic id and keeps the old messages. That is the in-session create bug. A zustand wrapper around `ChatUiState` would preserve both mistakes.

This design stores what the APIs actually return. `GET /topics` is a catalog. `GET /topics/current/messages` is one thread. The client keeps those two documents, not a synthetic `chats[]`.

## Catalog + session, not `chats[]`

Rejected: keep `Chat[]` and `activeChatId`, put it in zustand, add `previousTopicId` on the side.

That still invites `getActiveChat`, still invites remapping `chat.id`, and still lets a listing grow a message array that the dropdown never needs. The unused `createChat` / `selectChat` path in `state.ts` exists because the type allows many threads in one blob.

Flattened store:

- `catalog.byId` / `catalog.order` are listings.
- `session` is the only `messages` array.
- Switching topics replaces `session`. It does not splice another chat's messages into view.

Memory. Inactive topics are not retained as threads. Select always refetches `GET /topics/current/messages`. That matches the server. The DO already keys history by current topic.

## `shellPhase` instead of `isLoading && isConnecting`

Rejected: two booleans, or `connection.status` plus a `hydrating` flag, with the thread doing `if (loading || connecting) skeleton`.

Those flags overlap. Hydrate is connecting. Switch is neither. Reconnect is connecting but should not tear down a revealed thread. Components will get the combination wrong.

One discriminant `show: "skeleton" | "thread" | "error"` with a `reason` only when it is skeleton. First-connect skeleton and switch skeleton look the same on purpose. The same `MessageSkeletons` tree is the Suspense fallback, so the shell does not change at hydrate.

`revealed` is the one extra bit. Without it, every `socket_closed` would flash skeletons over a live transcript. With it, reconnect is a header status. Switch still skeletons because `switch !== null` ranks above `revealed`.

## RSC loads data, islands own interaction

Rejected: client `ChatWorkspace` that `useState`s the snapshot and also fetches topics after mount.

The page already has a server session. Both GETs belong next to `loadCurrentChatSnapshot`. Parallel fetch on the server means the dropdown has rows on first paint after Suspense, not a second spinner.

`ChatFrame` and `MessageSkeletons` stay server components so the fallback is the real chrome. Zustand is created in a client provider from that bootstrap. Socket, composer, menus, and the thread branch are islands. Do not mark the whole page client.

Rejected: persist zustand across navigations as a singleton. The RSC bootstrap would fight a leftover store.

## Topic birth clears the thread

Rejected: `withTopic` in-place id swap. That is the bug. Old messages belong to the old topic. Showing them under the new id is a lie.

When WS carries a new `topicId`, snapshot `handoff` from the session that is going away, then `messages: []`. The user message that triggered create stays on the previous topic. Going back is HTTP select, not a local undo of the array.

The previous-topic control is not a generic history stack. Catalog already has every topic. The button exists because the user just got yanked to a new empty thread and needs a named way back. Exact copy: `Change to Previous Topic, "{title}"`. If `handoff` is null, no button.

## Select is HTTP, socket stays up

Rejected: close and reopen the websocket on topic change so the client "binds" a topic.

`edu-api` `POST /topics/:id/select` updates `userCurrentTopic`. Chat DO uses `getCurrentTopic`. The next `message` frame follows the new row. Reconnect would only add skeleton time.

Switch sequence is `beginSwitch` → POST select → GET current messages → `commitSwitch`. Skeleton for the whole round trip. If POST fails, `failSwitch` and the old session remains.

## nanoid

Rejected: keep `crypto.randomUUID()` until "later". The task is client message ids via nanoid, matching the backend topic id generator. One helper, used at send. Server ids are not rewritten.

## What this is not

Not a multi-chat sidebar. The dropdown is a selector over listings, not a second thread cache.

Not streaming catalog rows. Title/summary refresh is `GET /topics` after topic birth, not WS.

Not showing skeletons on every `connecting` after first `ready`. That would punish flaky networks.

Not keeping `ChatUiState` as the store shape with selectors painted on top. If `chats` is in the store, this candidate failed.
