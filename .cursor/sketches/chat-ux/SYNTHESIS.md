# Synthesis. Chat UX redesign

## Pick

Base is candidate B. Cross-judge [Arena cross-judge](306cfdc0-6047-42a8-a9eb-7d2073be6b7a) scored B 24, A 21, C 20. Parent scores agreed on the load-bearing criterion. Only B makes Stop structurally processable. `webSocketMessage` returns after `ctx.waitUntil(executeRun)`. A later `stop` frame can abort.

Laziness does not override that. A and C still await the turn (or hope the isolate delivers mid-await). Graft `waitUntil` into A would be bolting B’s run machine onto a reducer that was not designed for it. Keep B’s run ownership. Cut B’s extra surface.

## Rejected

A. Smallest diff, broken Stop, pending actions in `agent_step` with no home when there is no topic.

C. Best product line (`command | reply | proposal`) and best markdown-while-streaming note. Stop still rests on an unproven delivery assumption. Frame log plus `restore` is two recovery paths.

## Grafts into B

From A
- Do not add `packages/chat-contract`. Extend `backend/edu-api/src/messages/schema.ts` and `web/lib/chat/ws-schema.ts` in lockstep.
- Math plugins only on `complete` or `cancelled` assistant messages. Streaming text is markdown without katex.

From C
- `Route` is `command | reply | proposal`. Pure explanation streams. Mutations and grading wait for a typed decision.
- `parseJsonFromLlm` returns `null`. No fallback argument.
- One terminal server event `run.ended` replaces the streamed preview. No separate `message-completed` plus `run-finished`.
- Pending proposal lives in Durable Object `ctx.storage`, not a new D1 table and not `agent_step`.

## Trim from B

- No `finishReason` column. Persist stopped text as a normal agent row. Client marks `cancelled` from `run.ended.status`.
- No delta sequence numbers. `run.ended` is the repair.
- No `packages/` workspace.
- Keep `GET /topics/current/messages` next to existing `GET /topics`.

## Contract the implementer fills in

### Wire (zod, both schema files)

Client
- `{ type: "message", message, parts }` as today (`message` is the client uuid)
- `{ type: "stop", runId }`
- `{ type: "decision", proposalId, decision: "accept" | "reject" }`

Server
- `{ type: "ready", userId, pendingProposalId?: string | null }`
- `{ type: "error", message, runId?: string | null }`
- `{ type: "run.started", runId, messageId, topicId?: string }`
- `{ type: "run.delta", runId, messageId, partIndex, text }`
- `{ type: "run.ended", runId, messageId, parts, topicId?: string, status: "completed" | "cancelled" | "failed" }`

Delete `busy` and `response` as connection/result modes. Overlap while running is `error` or silent drop of a second `message`. Accept `stop` and ignore other types while a run is live.

Add `ProposalPart`: `{ type: "proposal", proposalId, prompt, proposal }` with proposal kinds `create-topic | update-topic | grade-answer | new-question`.

Option items keep `{ label }` for follow-ups that resubmit label text. Proposal cards use `ProposalPart`, not option string matching.

### Word buffer

Pure functions in `backend/edu-api/src/chat/word-buffer.ts`. Flush every 8 complete words (whitespace after the word). Flush remainder on part complete. Table tests. Shared logic can be copied into a web test only if needed. Do not extract a package.

### DO run

In-memory `AbortController` plus `ctx.storage` `{ runId, messageId }` and `pendingProposal`. `webSocketMessage` parses the client frame first, then routes. `submit` while running is dropped or `error`. `stop` aborts. `decision` while running is dropped.

Start. Persist user row. Create run. Broadcast `run.started`. `this.ctx.waitUntil(executeRun)`. Return.

`executeRun` calls `handleChat` with `sink` and `signal`. Visible prose goes through `streamLlm` + word buffer + `run.delta`. JSON/classify stays `invoke`. Persist agent row once. Broadcast `run.ended`. Clear storage.

Broadcast to every socket on the DO (`ctx.getWebSockets()`), not only the sender.

### Client

`ChatConnection` split.
- Transport. `connecting | ready { userId } | error { message }`
- Activity. `idle | running { runId, messageId }`

`ChatMessage` keeps `parts`. Assistant has `status: streaming | complete | cancelled`.

`reduceChat` is the only UI writer. No `useEffect` for history or WS-to-state sync.

Composer. No `disabled` on the textarea. `sendAffordance`: connecting or empty → send disabled. running → Stop. ready with draft → Send. Enter does not Stop.

### History

`GET /topics/current/messages` → `{ topic: { id, title } | null, messages: ResponseMessage[] }`. `loadAllMessages` ascending, no limit. Next server component `getSession()`, bearer fetch, zod parse, Suspense around the async child. `ChatWorkspace` takes the snapshot as initial state. Connection still starts `connecting` until `ready`.

Chat id for a loaded topic is the topic id.

### Agent policy

Slash `/new /update /ans /new-qns /topic` execute (`/topic` is explain, not grade).

No topic and no `/new`. Proposal `create-topic`. Do not `createTopic` until accept.

Inferred `update-topic` / `new-question` / `grade-answer`. Proposal part. Delete `applyUpdateDirect`. Delete JSON fallbacks that invent title/summary/question.

Inferred `chat`. Stream a reply. No proposal.

`decision` accept runs the stored proposal. reject clears it and sends a short agent line.

### Markdown

`web/components/chat/assistant-markdown.tsx`. itsme component map from `profile-page.tsx` `profileChatMarkdownComponents`. `remark-math` + `rehype-katex` only when status is complete or cancelled. Import katex CSS once in that component or `app/layout.tsx`. User rows stay `SkillInlineText`. Options are buttons that submit the label as a new user message. Proposal cards call `decision`.

### Sequence (verify each before the next)

1. Schemas + word-buffer tests.
2. DO parse-first, waitUntil, stop, `run.*` frames (invoke-only is fine: `run.started` then `run.ended`).
3. Client reducer, composer Stop, parts rendering (plain text).
4. `streamLlm` + buffer on `generate_question` then the other prose calls.
5. History endpoint + RSC Suspense.
6. Markdown + katex on complete.
7. Route union, proposals, delete auto-create and `applyUpdateDirect`.

### Code style (must follow, name the rule in comments only when a why is needed)

No ternaries (if blocks). No over-abstraction. No wrapper-only functions. Zod at JSON boundaries. No `any`. Prefer inference, no explicit return types. No `useEffect` for fetch or state sync. Comments only for why. pnpm. Do not invent types when zod/infer exists.

### Out of scope

Chat sidebar. Image parts on the wire. Shared protocol package. D1 migrations. Cursor pagination.
