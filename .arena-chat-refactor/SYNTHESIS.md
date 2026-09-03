# Synthesis

**Base:** candidate-b (only complete candidate; A aborted).

**Pick reason:** Flattens to catalog + session, kills `chats[]`/`withTopic` remap, and encodes skeleton vs thread as one `shellPhase` discriminant. Matches the product rule "only ever show the current topic."

## Grafts / tweaks

1. On WS `topic_born`, after clearing the old thread, **refetch** `GET /topics/current/messages` and `commitSwitch`-style replace so the create-topic intro (and any server-persisted user row) appear. Do not rely on an empty local thread alone.
2. Keep existing `reduceChat` logic as pure helpers where possible (`applyWs` internals), but the store shape is B's, not `ChatUiState`.
3. `ChatFrame` may be a shared layout component; Suspense fallback and live app must render the same chrome + `MessageSkeletons`.
4. Previous-topic button copy exactly: `Change to Previous Topic, "{title}"` from `handoff` only.
5. nanoid via `clientMessageId()` for optimistic sends.

## Rejected

- Thin zustand wrap of `ChatUiState.chats[]`
- Skeleton on every reconnect after first `ready`
- Closing WS on topic select
