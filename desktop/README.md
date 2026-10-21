# EdU desktop

The shipping EdU app is a standalone Electron tutoring harness. It keeps EdU’s
stylesheet and theme provider directly, with the same system typography, topic
sidebar, learning suggestions, composer, study document, and tutor chat. Light,
dark, and system appearance are included.

## Use the app

Open **Settings → Providers → Add provider** and choose an account:

- **Codex:** click **Connect** and finish sign-in in your browser.
  Your account needs Codex access. The app bundles the Codex app-server runtime.
  Your account needs model credits.

- **Claude:** click the gray Claude icon in the model picker, install Claude Code
  if needed, then click **Connect**. EdU finds the CLI and starts sign-in if needed.
- **Antigravity:** click the gray Antigravity icon, install its CLI if needed, then
  click **Connect**. The connection check sends a small model request.

Provider setup is available from existing chats too. Connecting another provider
keeps the current chat's provider; start a new chat to use the new account.
EdU detects CLIs on PATH and in standard installation folders. Custom installations
can still be configured through **Settings → Providers → Binary path**.

Claude and Antigravity use their CLI's existing credential store. Disconnect
only disables their use in EdU; it does not log the shared CLI out. These adapters
support text and extracted PDF text; use ChatGPT for visual sources.
CLI models use their configured default; Claude also exposes Sonnet, Opus, and
Haiku aliases, and Antigravity loads its catalog from `agy models`.

Provider settings and the model picker check CLI installation and account connection
separately, with checkmarks beside completed steps. Use the refresh button beside
installation to recheck that provider. All providers are checked at startup and every
five minutes while EdU is running. Checks never start sign-in or re-enable disconnected
providers; Antigravity uses its CLI's quota report rather than generating a model response.
Connection and save errors appear beside their controls without moving the page.
Open **Advanced settings** to change the display name or binary path, then click
**Save changes**. ChatGPT uses
its bundled runtime when its binary path is empty. Binary changes stop idle
runners and require reconnecting a CLI provider. Settings persist across restarts.
Use **Settings → Appearance** to select System, Light, or Dark.

Lessons require an internet connection.
The app supplies the runtime, agent loop, Tutor Me skill, references, source
readers, PDF renderer, and persistence. Users do not install Node, Python, or
a skill. ChatGPT includes its runtime; Claude and Antigravity
require the provider CLI described above.

Choose **New scratchpad** and describe your goal or attach PDF, PowerPoint (`.pptx`), image, text, or code materials. The tutor infers Topic, Test, or Generic from the chat and creates it with the matching role tool. No type is selected or precreated by the composer.
Topic scratchpads contain a source-linked curriculum and a story summary. **Confirm plan & begin** authorizes teaching.
Test scratchpads source questions one at a time and retain each question and learner answer.
Generic scratchpads contain free markdown and source references.
Attachments count as content, so Send works without typed text. Chat requests include the open scratchpad and saved progress; explicit tags can direct a request to another scratchpad.
Reopening EdU restores the most recently viewed scratchpad independently of the selected chat.
Use the provider/model picker beside the paperclip to choose your provider and model.
Codex models and reasoning options come from the bundled runtime’s model catalog;
new selections use GPT 6 Luna for Codex, Haiku 5.5 for Claude Code, and Gemini 3.8 Flash
(High) for Antigravity. The picker always shows the selected model. Visual sources
require a model with vision support.

Tutors start automatically when you send a message. A topic retains its provider;
its model and reasoning setting can be changed while its tutor is idle. Existing
saved runners retain their provider. Up to eight tutors can work independently.
Restarting a process preserves notes and pending questions; send a message to
resume from the saved handoff.

Use the paperclip or drop files onto the composer to add sources. Use the download
button to export study notes, the conversation, and source assets. PDF and image pages are rendered on demand
using the bundled canvas runtime and displayed inline when the tutor refers to
them. Uploaded materials and relevant conversation/state are sent to the model
provider when tutoring. Conversations and study files are stored locally; there
is no account synchronization.

PowerPoint imports extract text and speaker notes in slide order and preserve the
original deck. Attach a PDF export when the tutor needs to inspect slide visuals.

## Tutor memory

Each document lives in `scratchpads/<id>/` with `scratchpad.md`, `scratchpad.state.json`, and `assets/`.
The state has an explicit `topic`, `test`, or `generic` discriminator and is validated with Zod.
Topic goals are arrays; per-thread part progress is active or completed. Test questions store one answer and the threads that wrote that question. Generic state has no writer list.
The older topic file layout is not migrated.

The supplied management skills and templates are bundled verbatim under `resources/tutor-me/skills/` and `resources/tutor-me/scratchpad_templates/`.
The agent applies the matching management skill to every scratchpad it reads. A turn can use several scratchpad types simultaneously.
Model tools have role prefixes, such as `topic_getQuestions`, `test_getQuestions`, and `generic_getReferences`. Every call validates its target type, access, and thread identity.
`test_getMistakesForTopic` can read topic mistakes when preparing a test. Reads never register writers; topic writes register the current tutor thread, and test question writes register the current thread on the affected question.

Tools identify documents with stable `scratchpad_N` handles saved with each chat. `read_scratchpad` returns the state, role skill, and paginated markdown, including archived documents.
Tagged/open scratchpads and documents created in the current turn are writable. Archived scratchpads are read-only, including when a chat tagged them before they were archived.
Sources can be read from all accessible scratchpads. Private chat handoffs and checked assessment keys remain separate from public scratchpad documents.

`src/runners/tutor-graph.ts` coordinates tool execution, validation, recovery, and publication for structured-output adapters. Codex retains its native model loop and executes callbacks through the same tool graph.
Tools execute in order so dependent writes remain deterministic. Read results must reach the next model request before a reply publishes.
A complete private chat handoff is required before publication. Scratchpad writes, the handoff, and the reply commit together through the repository mutex and SQLite transaction.
Concurrent independent changes merge; stale replacements and attempts to overwrite an existing test answer are rejected. A later attempt is a new test question.
SQLite recovery restores committed scratchpad files after an interrupted write.

Topic teaching waits for learner plan confirmation. The tutor model evaluates goal satisfaction and confirmed mistakes using the supplied skills.
Provider web search and URL-reading capabilities remain available, subject to provider permissions. Unavailable lookup must be reported to the learner.
Pasted screenshots reach Codex as image inputs. CLI adapters support extracted source text and report unsupported image reads.

## Development

From this directory:

```sh
pnpm --dir ../packages/ui install --frozen-lockfile
pnpm install
pnpm dev
```

From the repository root, `pnpm desktop:dev` also starts the app after installing
the desktop dependencies. Development requires Node 22.13+ and pnpm 10.26.0.
The install script downloads Electron and the pinned Codex native package for the
developer. Builds copy the host’s Codex binaries into `resources/codex/`, outside
ASAR in the packaged app. Packaged users only open the app.

```sh
pnpm typecheck
pnpm test
pnpm test:smoke
pnpm package:dir
pnpm package
```

`package:dir` produces a local app bundle in `release/` without macOS signing.
`package` builds the host platform’s distributable: macOS DMG/ZIP, Windows NSIS,
or Linux AppImage. Release signing and macOS notarization require the distributor’s
credentials; configure them in the release environment. Build native installers
on their target OS/architecture so the canvas and Codex binaries match. No release is
published by these commands.

`pnpm dev:renderer` serves a browser preview at port 5174. Native account and
runner operations require Electron.

## Harness boundaries

LangGraph coordinates structured tutoring turns through `model`, `tools`, `validate`,
`recover`, and `publish` nodes. Codex, Claude Code, and Antigravity remain the
underlying agent runners; LangGraph does not replace them with a chat model.
Codex retains its native tool loop and resumable threads. CLI adapters retain
their structured EdU tool protocol.
The graph enforces each adapter's existing request limit, while the manager
retains process supervision, the turn deadline, and the final SQLite commit.

Phoenix-compatible OpenTelemetry spans are saved as OTLP protobuf files under
the active `workspace/phoenix/` directory. Main-process and worker spans share
trace context and include graph nodes, agent invocations, EdU tools, repair, and
commit status. Operational metadata excludes learner content and credentials.
Tracing failures appear in diagnostics without invalidating a saved lesson.
The exporter and its README are installed in that directory and included outside
ASAR in packaged resources. Inherited LangSmith tracing flags are disabled in
the runner. No collector connection is made by the app.
See [Phoenix Exporter](../phoenix/README.md) for manual upload and local Docker setup.

- The renderer is sandboxed with context isolation and no Node integration.
  A narrow preload bridge exposes validated domain operations; the main process
  checks IPC senders. API credentials never enter the renderer.
- Codex manages ChatGPT sign-in, token refresh, cancellation, and logout through
  its app-server protocol. Its account home is private to EdU and uses the OS
  credential store. EdU does not import another CLI’s credentials or inherited
  model API keys. Disconnect stops that provider’s runners before logging out.
- Claude exposes only WebSearch and WebFetch during tutoring; MCP servers, hooks,
  and session persistence remain disabled. Antigravity selects an EdU main agent
  with finish, search_web, and read_url_content and terminal sandboxing. Title
  generation keeps native web tools disabled for both CLIs.
  Their schema-constrained responses request the same attachment
  and save operations as the other providers; EdU validates and executes them.
  Native subprocesses are tracked for stop/timeout cleanup. CLI output is bounded,
  provider API keys are removed from the inherited environment, and invalid saves
  must be corrected before a reply can be committed.
- Each runner is an Electron utility process using Electron’s bundled Node
  runtime. Codex runners own a native app-server child, which is terminated on
  stop, timeout, crash, or quit. Turns have a five-minute deadline and validated
  tools. Codex runs persistent, read-only threads with shell, browser, plugins,
  hooks, and multi-agent features disabled. The shared study tools read bundled
  skill references and imported topic assets and validate saved learning state.
  Each Codex chat retains its native thread ID and resumes that thread across
  turns and process restarts, refreshing instructions from the current learning
  state. A pending binding marks an interrupted or uncommitted turn; the next
  request creates a new thread from the saved transcript instead of trusting
  unseen native output. An explicitly missing native thread is reconstructed;
  transient provider errors are reported without silently replacing the thread.
  Threads created with older study tools are reconstructed from committed history
  once so the new retrieval and revision tools are registered.
  Providers without native session support receive the full saved transcript.
  Its bundled code-mode host stays enabled because some models require it to
  call those study tools; disabling it silently hides the tools from those models.
- Codex tutoring turns run from `workspace/chats/<chat-id>/`. Topic summaries, structured state, and source assets belong to their topic.
  Private handoffs belong to each chat. Codex's
  private account home remains in `workspace/providers/codex/`.
- The tutor names and creates scratchpads from the chat. Chat titles do not rename tagged scratchpads.
- Storage lives under Electron’s `userData` in `workspace/`. Local SQLite
  `state.sqlite` stores chats, ordered messages, private chat handoffs, provider
  session bindings, runner configuration, and provider settings. A sequenced
  event log records changes in the same transaction as the current state.
  WAL mode, full synchronous commits, and serialized writes protect committed
  conversations. Replies become visible after the transaction commits.
- Scratchpads contain `scratchpad.md` (public markdown), `scratchpad.state.json`
  (versioned role-specific state), and `assets/` (original
  materials and prepared manifests under `assets/cache/prepared/`). Legacy
  workpad files are ignored; older notes remain intact. Private current
  keys and session logistics belong to the chat handoff in SQLite. Topics are
  discovered from these folders and refreshed before snapshots and saves.
  Structured topic mutations enter the SQLite transaction; a pending-files marker
  lets startup recover their files after an interrupted write. Files use verified
  temporary writes and atomic rename. Native session bindings and private keys
  are omitted from public chats.
- Existing `workspace.json` and per-chat `chat.json` data migrate to SQLite on
  load. After a successful commit and database read-back verification, migration
  sources (`workspace.json`, `workspace.legacy.json`, `chat.json`) and the obsolete
  `settings.json` mirror are removed. Startup also removes orphaned chat folders
  and temporary files created by the atomic writer. Active assets, topic documents,
  diagnostics, and provider credentials remain available. Corrupt or uncommitted
  migration data is reported and retained.
- Every successful turn requires a complete saved learning state. Draft plans
  cannot advance without explicit learner confirmation. If Codex completes without
  a valid save or visible reply, the harness continues the same thread with up to
  two correction attempts; rejected saves include validation feedback. Private fields are
  excluded from public state. Semantic adherence still
  depends on the selected model; the full skill and private handoff are supplied
  each turn. Public snapshots and learner exports omit the private handoff/key.
- Per-turn JSONL diagnostics are saved in `workspace/chats/<chat-id>/diagnostics/`.
  Failed turns show a Diagnostics disclosure with recent tool calls, validation failures,
  recovery attempts, and commit status with a trace ID. Successful turns keep diagnostics
  hidden. The document's folder button opens the topic workspace in Finder. Logs omit prompts, tool arguments,
  replies, private learning state, and account credentials; token-like error text
  is redacted.
- Scratchpad management skills are vendored unchanged in `resources/tutor-me/skills/`.
  `read_skill` loads their supporting references and the supplied schemas, tool descriptions, and markdown templates.
  Imported source text and cached page images are shared with the role-aware study tools.
  Native shell and subagents are not exposed to the tutor.


Unit tests exercise persistence, concurrent runners, stop/restart/crash behavior,
plan confirmation, private assessment state, and PKCE callbacks. Native smoke
tests launch the actual sandboxed Electron app, create runners/topics, and restart
it using a disposable data directory. Model tests use local OpenAI-compatible HTTP and Codex JSON-RPC fixtures, plus the
real bundled Codex runtime for initialization, model discovery, and tool
registration and native thread resumption. Opt-in live tests use an already connected account:

```bash
PRUNE_LIVE_DATA_DIR='/absolute/path/to/prune-desktop' pnpm exec vitest run tests/codex.live.test.ts
PRUNE_LIVE_DATA_DIR='/absolute/path/to/prune-desktop' PRUNE_PACKAGED_APP='/absolute/path/to/EdU.app/Contents/MacOS/EdU' pnpm exec playwright test tests/codex.live.smoke.ts
```

The Vitest check replays the latest Codex topic in an isolated copy. Quit EdU
before running the native check: it retries the latest learner request in the
actual desktop workspace and verifies the reply, notes, handoff, and trace on disk.
Both checks make real model requests; normal tests skip them. Browser account
authorization remains an interactive action.

Implementation references: [Electron utility processes](https://www.electronjs.org/docs/latest/api/utility-process),
[Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[Codex app-server](https://developers.openai.com/codex/app-server), and
[T3 Code’s Codex provider](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/CodexProvider.ts)
and [provider/model picker](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/chat/ProviderModelPicker.tsx).
T3 Code informed provider/account separation and runtime model discovery;
EdU keeps its own styling and Tutor Me harness.

CLI adapter references: [Claude Code CLI](https://code.claude.com/docs/en/cli-reference),
[Antigravity headless mode](https://antigravity.google/docs/cli/headless/),
[Antigravity agent capabilities](https://antigravity.google/docs/subagents/).
Live Claude/Antigravity checks require installed provider CLIs and signed-in
accounts; automated tests use executable protocol fixtures and make no account
requests.

## Structured scratchpad content

Topic and test `scratchpad.state.json` owns the document and learning evidence.
`document.blocks` contains stable IDs for Markdown, sources and terminology.
Role edit tools apply ordered add/edit/delete changes atomically, with optimistic
revision checks. `present` selects saved blocks for the chat reply; questions are
rendered from recorded steps. Markdown, directory links and section anchors are
projections generated by the app. Generic scratchpads retain free Markdown.

Legacy content is imported once on startup. The original Markdown is retained as
`scratchpad.legacy.md`. Once imported, external edits to generated Markdown are
replaced by the JSON projection. Existing progress and question history remain.
The repository transaction commits scratchpad mutations and the chat reply together;
its existing durable journal recovers interrupted file projection writes.
