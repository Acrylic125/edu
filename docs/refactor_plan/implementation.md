# Scratchpad refactor implementation plan

**Goal:** Extend the tutor's topic documents into topic, test, and generic scratchpads, with strict per-target role capabilities and concurrent multi-scratchpad reading.

**Spec:** The schemas, templates, and tools under `scratchpad_templates/`, the unchanged skills under `skills/`, and the user request.

**Architecture:** Persist a discriminated scratchpad state in `scratchpads/{id}/scratchpad.state.json` beside `scratchpad.md` and `assets/`. Keep the app's existing topic collection and navigation identifiers as internal document IDs, while exposing scratchpad terminology. Role-prefixed model tools validate the target type on every call; no mutable global role exists. All writes stage in a session and commit through the repository mutex.

**Constraints:** Preserve supplied skill wording verbatim. No compatibility with the old on-disk topic layout is required. Use Zod, inferred types, pnpm, and existing provider boundaries. No commits or publishing requested.

**Decisions:** Generic uses the `generic` discriminator despite the schema example's `test` typo. `threadTutors` is an array, matching existing code and the spec's multiple-thread semantics. Topic goals become arrays and progress has only active/completed statuses. Retain topic-only curriculum and question writers needed to maintain the supplied state and document.

## Tasks

- [x] Add schema and service regression tests covering all three states, wrong-role access, read purity, writer attribution, open questions, immutable answers, and concurrent writes.
- [x] Implement the discriminated schema, role-specific mutations and services, template rendering, durable file layout, and asset references.
- [x] Bundle exact copies of the supplied skills/templates; replace legacy tutor instructions with role-aware context and role-prefixed tools; validate access for mixed scratchpads in all provider paths.
- [x] Update creation/navigation/document views for scratchpads; adapt existing regression tests; run typecheck, full unit tests, build, and focused UI checks.

## Review focus

- A forged role or raw internal ID must not grant another type's capabilities.
- Reading another scratchpad never registers a writer.
- Concurrent test answers cannot overwrite an existing answer or attribute a content mistake as a question write.
- Archived/read-only scratchpads remain readable but cannot be mutated.
- All provider tool catalogs use the same role enforcement, including handles created during a turn.

## Verification

- `pnpm --dir desktop typecheck`: passes.
- `pnpm --dir desktop test`: 335 passed, 2 opt-in integration/live tests skipped.
- `pnpm --dir desktop build`: passes.
- `pnpm --dir desktop exec playwright test tests/new-topic-attachments.smoke.ts tests/topic-context.smoke.ts`: 16 passed, including creation/reload for all three types.
- All seven supplied skill files and nine template files match their bundled copies byte for byte.
- Independent review found an archived-write edge case. Regressions now verify both historical archived tags and archiving between staging and commit. Attached-source page validation and interrupted scratchpad temporary-file cleanup also have regressions.

## Creation correction

The new-scratchpad composer starts a chat with a persisted pending creation request and attaches sources to that chat. It creates no Topic in advance. The tutor infers the role from the full conversation and sources, calls its matching creation tool, and supplies the name. Successful creation clears the pending request and opens the new scratchpad when that chat is active. An unclear goal can be clarified without creating a document. No type selector is shown.

Creation correction checks: 335 unit tests passed, 2 opt-in tests skipped. Eleven Electron smoke scenarios passed across request-based role creation, attachments, chat navigation, and keyboard context. The packaged app was reopened in the same scratchpad workspace, and its new-scratchpad composer was verified to have no type selector. Navigation fixtures now use a connected local provider and matching document/state timestamps for deterministic ordering.

## Duplicate creation correction

The initial composer created a Topic before the first chat request, while the tutor could also create the same Topic. The saved trace confirmed one app-created document followed by a successful tutor creation in the same request. Composer creation has been removed. Creation tools now reuse a matching type/name bound to the current user request, including repeated tool calls; the transaction rejects a duplicate that bypasses the session guard. Created IDs are bound to the originating user request for that check. Archived plans do not produce chat confirmation actions. The unrequested document type badge was removed.

Verification: typecheck and build pass, 340 unit tests pass with 2 opt-in tests skipped, and 17 Electron smoke tests pass. The existing two-document pair was backed up and repaired using WorkspaceRepository.mutate: the retained document's notes/state were verified unchanged, the redundant document was archived, and chat references now point to the retained copy. The rebuilt app was visibly verified with one active sidebar entry, one chat confirmation, and no type badge.

## Plan confirmation controls

The renderer previously added a confirmation action for every tagged draft plan while also rendering the tutor's responseQuestion options. Chat controls now follow the saved learning phase: awaiting_plan_confirmation uses the app confirmation action, while other phases retain their response choices. The public chat exposes only the phase, leaving the private handoff and answer key hidden. Saving a plan-approval handoff removes redundant response choices when an actionable draft exists, and the runtime instructions explain the app-owned action. Supplied skills are unchanged. Existing saved messages also render one confirmation UI after reload.

Verification: 342 unit tests passed with 2 opt-in tests skipped; typecheck, build, and packaging passed. All 13 focused Electron smoke tests passed, including approval submission, existing-message reload, and preservation of unrelated response choices.

## Scratchpad maintenance and tutoring recovery

The saved calculus trace showed successful question/answer writes without a topic summary update, an unrecorded follow-up reaching chat, and a later recovery reply describing tool repair instead of tutoring. Teaching evidence and active-check clarifications now require a topic_updateTopic summary write before publication. Pending topic checks must match an unanswered question recorded in the current thread. Pending-question replies must include that question; invalid replies are withheld from streaming and returned for correction. Both provider graph paths use an internal recovery message that restores the original learner request. Supplied skills remain unchanged.

Website references in the topic directory now render as source links. Scratchpad references in the directory and document body receive their navigation targets and callbacks.

Verification: 350 unit tests passed with 2 opt-in tests skipped. Typecheck, build, and packaging passed. All 15 focused Electron smoke tests passed, including story updates after an answer, reload persistence, and opening the directory's website source. The affected local scratchpad was backed up and its taught explanation restored from the existing chat. Structured progress and chat history were verified unchanged.

## Creation and confirmation prerequisites

A fresh creation request could read existing scratchpads but had no write target. Denied activation/question calls were kept as permanently unresolved writes even after the tutor created a new draft. Recovery then required those calls to be retried, while the draft correctly prohibited teaching before approval. The rejection ledger now distinguishes creation and confirmation prerequisites from malformed or failed content writes. A valid saved draft plan resolves only those unmet prerequisites; it never applies the denied operations. Invalid curriculum and other failed mutations remain publication blockers. New-topic tool results direct the tutor to present the plan and await approval.

Publication validation failures now carry a short retry message for the learner and separate internal detail for Diagnostics. Existing read/write permissions and the supplied skill wording are unchanged.

Verification: 354 unit tests passed with 2 opt-in tests skipped. All 22 focused Electron smoke tests passed, including a new-scratchpad request that first attempts read-only writes, creates a draft, attempts teaching before approval, then successfully publishes only the draft plan. The existing curriculum-write rejection and role/access regressions still pass. Typecheck, build, and packaging passed; the app was reopened in the same workspace.

The failed calculus request was retried in its original chat with the live Codex provider after reopening. It committed a source-linked draft plan and displayed the confirmation action without a runtime error. Teaching was left awaiting the learner's approval.
