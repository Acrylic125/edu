# Topic state refactor

`topic.md` now serves as a conceptual summary. Versioned `topic.state.json`
contains parts, source references, goals, mistakes, and per-thread question and
answer history. Existing topics start with empty structured content/progress,
as requested. Their old notes remain intact; per-topic workpads are unused and are neither read nor written.

StateService exposes the planned readers and writers across OpenRouter, Codex,
Claude, and Antigravity. Reads leave tutor membership unchanged. Writers register
the current app chat as a tutor. Continuation choices include every active thread
and only the next untouched part. Completed parts can be reactivated.

Writes stage during a turn and replay against current state under the existing
repository mutex. Topic changes, the chat handoff, and the reply commit together.
Summary/curriculum replacements reject stale edits. Referenced supplied materials
are copied and registered in the target topic before commit, preserving source
access in later chats. SQLite recovery retains committed app approval metadata
without replacing preserved legacy workpads.

## LangGraph orchestration

`desktop/src/runners/graph.ts` compiles an actual LangGraph `StateGraph`.
All provider adapters use its agent, tools, validate, recover, and finish nodes.
Conditional edges decide whether to execute tool calls, request a corrected
save/reply, consume read results in another runner request, or finish a validated
reply. The graph bounds runner attempts. Native Codex dynamic tools execute
sequentially inside its native agent runner.

The graph owns the per-turn attempt count and completion decision. Provider
adapters retain pending calls, tool results, protocol transcripts, replies, and
native connection lifecycle. StateService continues staging domain changes, and
the repository commits them atomically with the final reply. LangGraph does not
introduce another durable topic state or checkpoint store. Node transitions are
visible in existing diagnostics without logging private handoff contents.

Dependencies: `@langchain/langgraph` and its `@langchain/core` peer. The
[LangGraph Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)
describes the StateGraph and conditional-edge APIs used here.

Graph tests exercise rejected-save recovery, sequential malformed-save
invalidation, read-result consumption before publication, and bounded retries.
Provider tests assert actual graph-node execution across all adapters.

## Schema and interface decisions

- `threadTutors` is an array of `{id, progress}` because the plan requires multiple
  threads but illustrates the shape of one entry. A different collection shape
  would require a serialization adjustment.
- The recursive parent object and singular goals object follow the supplied
  schema. Supporting multiple goal objects later would require a schema revision.
- `recordQuestion`, `recordAnswer`, and `updateTopic` supply writers required by
  the specified history readers and editable curriculum. `materialIds` selects
  supplied sources when filenames are ambiguous. These extend the listed tool
  surface.
- Changes become durable with the final reply rather than immediately after each
  tool call. A failed or stopped turn leaves its staged mutations uncommitted.
- Legacy LearningState fields remain for database compatibility and existing UI
  projections. New tutor progress uses structured state; checked keys remain in
  each chat's private handoff. Old native Codex sessions restart with tool version 12.

## Verified behavior

The automated suite covers concurrent writers, read-only membership, continuation
selection, question/answer retention, explicit skips, reactivation, missing parts,
source copies from chats and sibling topics, stale-write rejection, fresh legacy
progress, corruption preservation, and interrupted confirmation recovery.

Commands:

```sh
pnpm --dir desktop test
pnpm --dir desktop build
pnpm --dir desktop exec playwright test tests/topic-context.smoke.ts tests/topic-history.smoke.ts tests/new-topic-attachments.smoke.ts
```

An independent review identified four important issues. Regression tests first
reproduced them, and fixes cover approval recovery, skipped questions, created-topic
chat context, and source continuity.

## Remaining limits

- The graph uses a generic missing-reply recovery prompt when a failed read follows
  a valid handoff. The actual tool error remains in the provider transcript;
  improving that wording is a deferred minor review finding.

- Embedded parent objects are snapshots and may lag canonical parent edits. The
  corresponding entry in content remains authoritative. Canonicalizing these
  snapshots is a deferred minor review finding.
- Internet search is unavailable in the existing harness. The guides disclose
  this and end practice when suitable supplied questions are exhausted. Internet
  sourcing requires a future search capability.
- Authenticated live-model teaching and provider schema acceptance were not
  exercised; credential-dependent tests remain opt-in.

The full existing native smoke suite also encounters the provider setup gate
introduced by base commit a18a5dc. These tests assume workspace access before
connecting a provider and fail before exercising this refactor:

- app.smoke: native sandboxed app manages runners and restores topics across restarts
- app.smoke: native Claude and Antigravity providers save settings and commit validated lessons
- app.smoke: existing chats can set up unconnected providers directly from the model picker
- app.smoke: provider settings show simple setup and keep failures beside the controls without moving the page
- app.smoke: provider setup rechecks installation and shows completion beside each step and provider
- chat-copy.smoke: copies user and assistant messages to the native clipboard
- chat-tabs.smoke: chat tabs virtualize, close, reopen, cycle recent views, and restore after restart
- chat-tabs.smoke: Ctrl+Tab chooses chats or topics from the focused context
- composer-drop.smoke: dropping native files into topic and chat composers attaches them without opening the picker
- composer.smoke: topic and chat composers keep runners internal when multiple runners are saved
- source-links.smoke: chat displays source diagrams and opens original materials from citations
- topic-activity.smoke: topic loading follows the current turn instead of earlier chat tags

Their onboarding fixtures remain unchanged. The focused connected-provider smoke
coverage includes curriculum confirmation, thread registration, and question
persistence without adding question transcripts to the summary.


## Incremental topic summaries

`topic.md` follows the title, special `<topic-directory />`, taught part headings,
Topic terminology, and Materials structure. Curriculum setup creates the directory
without presenting goal text as an explanation. Topic edits retain existing
explanations and refresh the directory hierarchy. The tutor fills gaps as material
is discussed and clarifies conceptual phrasing when learner mistakes expose an
ambiguity. Exact questions, actual answers, mistake history, and progress stay in
`topic.state.json`; checked keys and temporary logistics stay in the private chat
handoff. The summary is a revision document, not a conversation transcript.


## Question responses

The tutor follows `QUESTIONS.md` for source questions/examples, own-words
summaries, goal-based follow-ups, and the distinct sourcing rules for practice
and tests. Part-boundary optionality follows the learner's explicit instructions:
continue or quick practice after a check, with a continue option for short,
optional, unimportant parts. Continuing without assessment does not verify mastery.

`save_learning_state.responseQuestion` optionally supplies a prompt and response
options. The harness saves them with the assistant message in the same transaction
as its handoff and topic writes. The chat renders keyboard-accessible response
buttons; clicking sends the option through the existing chat send path. Typed
responses remain available. Older choices stay visible but inactive after a reply,
and choosing an option preserves any composer draft. Model conversation history
and message copies retain the choice prompt and options.

Tests cover choice validation, message persistence and public projection,
private-key protection, Codex session refresh for the changed tool schema, and
native keyboard submission with draft preservation and inactive history.
