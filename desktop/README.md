# EdU desktop

The shipping EdU app is a standalone Electron tutoring harness. Web delivery is
paused. It keeps EdU’s
stylesheet and theme provider directly, with the same system typography, topic
sidebar, learning suggestions, composer, study document, and tutor chat. Light,
dark, and system appearance are included.

## Use the app

Open **Settings → Providers → Add provider** and choose an account:

- **Codex:** click **Sign in with ChatGPT** and finish sign-in in your browser.
  Your account needs Codex access. The app bundles the Codex app-server runtime.
- **OpenRouter:** click **Connect account** and sign in in your browser.
  Your account needs model credits.

- **Claude:** install Claude Code, sign in once with `claude auth login`, and save
  the absolute path to `claude` in **Binary path**. Click **Check connection**.
- **Antigravity:** install Antigravity CLI, sign in once with `agy`, and save the
  absolute path to `agy` in **Binary path**. Click **Check connection**; this
  sends a small model request using your account.

Claude and Antigravity use their CLI's existing credential store. Disconnect
only disables their use in EdU; it does not log the shared CLI out. These adapters
support text and extracted PDF text; use ChatGPT or OpenRouter for visual sources.
CLI models use their configured default; Claude also exposes Sonnet, Opus, and
Haiku aliases, and Antigravity loads its catalog from `agy models`.

Change the display name or binary path and click **Save changes**. ChatGPT uses
its bundled runtime when its binary path is empty. Binary changes stop idle
runners and require reconnecting a CLI provider. Settings persist across restarts.
Use **Settings → Appearance** to select System, Light, or Dark.

Lessons require an internet connection.
The app supplies the runtime, agent loop, Tutor Me skill, references, source
readers, PDF renderer, and persistence. Users do not install Node, Python, or
a skill. ChatGPT and OpenRouter include their runtime; Claude and Antigravity
require the provider CLI described above.

Create a topic by describing your goal or attaching PDF, image, text, or code
materials. The tutor proposes a plan; **Confirm plan & begin** authorizes teaching.
It explains the material, asks Checks and Tests, and maintains revision notes.
Use the provider/model picker beside the paperclip to choose your provider and model.
Codex models and reasoning options come from the bundled runtime’s model catalog;
**Default model** follows its current default. OpenRouter’s **Auto** routes model
requests, and its catalog lists models that support tool calling. Visual sources
require a model with vision support.

Tutors start automatically when you send a message. A topic retains its provider;
its model and reasoning setting can be changed while its tutor is idle. Existing
saved runners retain their provider. Up to eight tutors can work independently.
Restarting a process preserves notes and pending questions; send a message to
resume from the saved handoff.

Use the paperclip to add sources and the download button to export study notes,
the conversation, and source assets. PDF and image pages are rendered on demand
using the bundled canvas runtime and displayed inline when the tutor refers to
them. Uploaded materials and relevant conversation/state are sent to the model
provider when tutoring. The app does not synchronize with the web account yet.

## Development

From this directory:

```sh
pnpm --dir ../packages/ui install --frozen-lockfile
pnpm install
pnpm dev
```

From the repository root, `pnpm desktop:dev` also starts the app after installing
the desktop dependencies. Development requires Node 22.12+ and pnpm 10.26.0.
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

- The renderer is sandboxed with context isolation and no Node integration.
  A narrow preload bridge exposes validated domain operations; the main process
  checks IPC senders. API credentials never enter the renderer.
- OpenRouter browser sign-in uses PKCE S256, a random state and callback path, and a temporary
  loopback listener. Keys are encrypted through Electron safeStorage. An insecure
  Linux `basic_text` fallback is rejected. Disconnect stops runners and deletes
  the local credential; revoking the provider key is done in OpenRouter.
- Codex manages ChatGPT sign-in, token refresh, cancellation, and logout through
  its app-server protocol. Its account home is private to EdU and uses the OS
  credential store. EdU does not import another CLI’s credentials or inherited
  model API keys. Disconnect stops that provider’s runners before logging out.
- Claude launches with built-in tools, MCP servers, hooks, and session persistence
  disabled. Antigravity selects an EdU main agent with an empty tools list and
  terminal sandboxing. Their schema-constrained responses request the same source
  and save operations as the other providers; EdU validates and executes them.
  Native subprocesses are tracked for stop/timeout cleanup. CLI output is bounded,
  provider API keys are removed from the inherited environment, and invalid saves
  must be corrected before a reply can be committed.
- Each runner is an Electron utility process using Electron’s bundled Node
  runtime. Codex runners own a native app-server child, which is terminated on
  stop, timeout, crash, or quit. Turns have a five-minute deadline and validated
  tools. Codex runs ephemeral, read-only threads with shell, browser, plugins,
  hooks, and multi-agent features disabled. The shared study tools read bundled
  skill references and imported topic assets and validate saved learning state.
  Each turn reconstructs context from the saved handoff and recent conversation.
  Its bundled code-mode host stays enabled because some models require it to
  call those study tools; disabling it silently hides the tools from those models.
- Codex tutoring turns run from `workspace/topics/<topic-id>/`. Notes, private handoffs,
  and source assets belong to that topic, independently of its runner. Codex's
  private account home remains in `workspace/providers/codex/`.
- `workspace/workspace.json` under Electron’s `userData` is the authoritative
  transaction. Writes are serialized, validated, read back, and atomically renamed.
  A corrupt workspace is reported rather than overwritten. Topics also have
  `topic.md` and private `agent.workpad.md` mirrors, plus an assets directory.
- Every successful turn requires a complete saved learning state. Draft plans
  cannot advance without explicit learner confirmation. If Codex completes without
  a valid save or visible reply, the harness continues the same thread with up to
  two correction attempts; rejected saves include validation feedback. Exact private pending
  keys are checked against outgoing notes/replies. Semantic adherence still
  depends on the selected model; the full skill and private handoff are supplied
  each turn. Public snapshots and learner exports omit the private handoff/key.
- Per-turn JSONL diagnostics are saved in `workspace/topics/<topic-id>/diagnostics/`.
  Failed turns show a Diagnostics disclosure with recent tool calls, validation failures,
  recovery attempts, and commit status with a trace ID. Successful turns keep diagnostics
  hidden. The document's folder button opens the topic workspace in Finder. Logs omit prompts, tool arguments,
  replies, private learning state, and account credentials; token-like error text
  is redacted.
- Tutor Me is vendored in `resources/tutor-me/`. Its shell/Python bookkeeping
  instructions map to the harness’s source tools and verified save transaction.
  Web search and subagents are not exposed; when no supplied Test fits, the tutor
  labels an authored exercise. These capabilities can be added as runner tools.

Unit tests exercise persistence, concurrent runners, stop/restart/crash behavior,
plan confirmation, private assessment state, and PKCE callbacks. Native smoke
tests launch the actual sandboxed Electron app, create runners/topics, and restart
it using a disposable data directory. Model tests use local OpenAI-compatible HTTP and Codex JSON-RPC fixtures, plus the
real bundled Codex runtime for initialization, model discovery, and tool
registration. Opt-in live tests use an already connected account:

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
[OpenRouter PKCE](https://openrouter.ai/docs/guides/overview/auth/oauth),
[Codex app-server](https://developers.openai.com/codex/app-server), and
[T3 Code’s Codex provider](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/CodexProvider.ts)
and [provider/model picker](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/chat/ProviderModelPicker.tsx).
T3 Code informed provider/account separation and runtime model discovery;
EdU keeps its own web styling and Tutor Me harness.

CLI adapter references: [Claude Code CLI](https://code.claude.com/docs/en/cli-reference),
[Antigravity headless mode](https://antigravity.google/docs/cli/headless/),
[Antigravity agent capabilities](https://antigravity.google/docs/subagents/).
Live Claude/Antigravity checks require installed provider CLIs and signed-in
accounts; automated tests use executable protocol fixtures and make no account
requests.
