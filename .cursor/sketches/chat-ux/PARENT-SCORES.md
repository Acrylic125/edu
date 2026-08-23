# Parent scores (before cross-judge)

Rubric 1-5. Not the pick until the judge returns.

## A parts-first reducer

1. Stop 2. Awaits `handleChat` in `webSocketMessage`. AbortController exists but Stop cannot be parsed until the turn ends.
2. Stream 4. Word buffer, sink, mint-then-delta. Visible prose only.
3. Parts 4. Parts kept. Math plugins off while streaming.
4. History 4. GET snapshot, Suspense, bearer.
5. Confirm 4. Typed `choice`. Confirms inferred answer and new-question too (heavier than needed).
6. Cost 5. No new package, no new table. Duplicate zod in lockstep.

Red flag. Stop is broken by the same await the how-explainer named.

## B run projection

1. Stop 5. `waitUntil(executeRun)` then return from the socket handler.
2. Stream 5. Sequence numbers, word buffer, mint assistant id.
3. Parts 4. Parts + markdown. No streaming fence closer.
4. History 5. Discriminated snapshot, invalid rows fail loud.
5. Confirm 5. Confirmation table, `/topic` unaliased, no `applyUpdateDirect`.
6. Cost 2. New package, new table, finishReason migration, more wire types.

Red flag. Package and table are real cost. Stop architecture is the one that matches the runtime.

## C frame log

1. Stop 3. Parse-then-route is right. Still hopes the isolate delivers WS during LLM await. HTTP fallback is named, `waitUntil` is not.
2. Stream 5. DO mints id first. Tail-only deltas. `part.end` for complete parts.
3. Parts 5. ProposalPart, closeOpenMarkdown, itsme components + katex.
4. History 4. GET `/chat/history`, restore on ready for pre-topic.
5. Confirm 5. Reply vs proposal is the product line. `parseJsonFromLlm` returns null.
6. Cost 3. New package as a prerequisite. Otherwise smaller than B.

Red flag. Monorepo package as a gate. Stop still rests on an unverified delivery assumption.

## Lean

Base C or A, not B, if cost is the tie-break. Graft B's `waitUntil` into whichever base wins. Graft C's reply/proposal line and markdown closer. Do not take B's package or confirmation table unless the judge shows A/C cannot store pending proposals.
