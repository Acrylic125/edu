# Candidate 2. Pure reducer core behind a command/read store

## Problem

`edu/web` is a fresh create-next-app with shadcn `base-nova` installed and ten UI primitives on disk. There is no chat code, no backend, and no data layer. We want the t3code silhouette (SidebarProvider, Sidebar with a thread list and a New chat button, SidebarInset holding a message list and a composer, an empty state that tells you to pick a chat or create one) without any of t3code's machinery. Grounding facts the design has to honor. `app/globals.css` already defines every `--sidebar-*` token in both themes, so the shadcn sidebar will theme correctly with zero CSS work. `components.json` sets `style: base-nova`, `rsc: true`, `iconLibrary: lucide`, aliases `@/components`, `@/lib`, `@/hooks`. The dependency list is `@base-ui/react`, not Radix, so every added primitive comes from the base-nova registry. `app/layout.tsx` renders `<body className="min-h-full flex flex-col">` under `<html className="h-full">`, which the shell must fit into rather than fight. `AGENTS.md` warns that this Next.js (16.3.2) diverges from training data, so anything version-sensitive gets checked in `node_modules/next/dist/docs/` first.

The shape is non-obvious for one reason. A chat UI is stateful, and the lazy version of it is a single client component holding four `useState` calls that every child reaches into. That shape works at this size and stops working the moment a second reader has to answer "what can change the selected chat?". The interesting question is where the state transitions live, not what the JSX looks like.

## Usage (caller's view)

### README

```md
## Chat shell

A local, UI-only chat. No network, no persistence, no streaming.

The domain lives in `lib/chat/` and knows nothing about React:

- `lib/chat/model.ts` holds the types and data constructors.
- `lib/chat/reducer.ts` holds the pure updaters, the reducer, and the selectors.
- `lib/chat/store.tsx` is the React binding. One provider, three hooks.

One rule for components. **Display data comes down as props or out of a read
hook. Intent goes up through `useChatCommands()`.** No component imports the
action union, calls `dispatch`, or touches `ChatState`.

    import { useChatCommands, useChatList, useChatView } from "@/lib/chat/store";

- `useChatList()` returns the sidebar rows, already titled and flagged active.
- `useChatView()` returns a discriminated union. Switch on it exhaustively.
- `useChatCommands()` returns `newChat`, `openChat`, `deleteChat`, `setDraft`,
  `send`. The object is referentially stable for the life of the provider, so
  it is safe in effect and callback dependency lists.
```

### Call site 1. `app/page.tsx`

The route stays a server component. One client boundary, opened by the shell.

```tsx
import { ChatShell } from "@/components/chat/chat-shell";

export default function Page() {
  return <ChatShell />;
}
```

### Call site 2. `components/chat/chat-sidebar.tsx`

Reads rows, writes intent. Zero domain logic, no title derivation, no active comparison.

```tsx
"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useChatCommands, useChatList } from "@/lib/chat/store";

export function ChatSidebar() {
  const rows = useChatList();
  const { newChat, openChat, deleteChat } = useChatCommands();

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <Button onClick={newChat} className="w-full justify-start">
          <Plus /> New chat
        </Button>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {rows.map((row) => (
              <SidebarMenuItem key={row.id}>
                <SidebarMenuButton
                  isActive={row.isActive}
                  onClick={() => openChat(row.id)}
                >
                  <span className="truncate">{row.title}</span>
                </SidebarMenuButton>
                <SidebarMenuAction
                  aria-label={`Delete ${row.title}`}
                  onClick={() => deleteChat(row.id)}
                >
                  <X />
                </SidebarMenuAction>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
```

### Call site 3. `components/chat/chat-panel.tsx`

The whole "which pane am I looking at" question is one exhaustive switch. There is no `chat && ...`, no `chats.length === 0 ?` nesting, and no way to render a thread and an empty state at the same time.

```tsx
"use client";

import { Composer } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";
import { Button } from "@/components/ui/button";
import { useChatCommands, useChatView } from "@/lib/chat/store";

/** Local to this file. Three lines of JSX with one caller. */
function EmptyPane(props: { title: string; body: string; action?: ReactNode }) {
  throw new Error("not implemented");
}

export function ChatPanel() {
  const view = useChatView();
  const { newChat } = useChatCommands();

  switch (view.kind) {
    case "no-chats":
      return (
        <EmptyPane
          title="No chats yet"
          body="Create one to get started."
          action={<Button onClick={newChat}>New chat</Button>}
        />
      );
    case "no-selection":
      return <EmptyPane title="Pick a chat" body="Choose a thread on the left." />;
    case "chat":
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <MessageList messages={view.chat.messages} />
          <Composer draft={view.chat.draft} />
        </div>
      );
  }
}
```

### Call site 4. `lib/chat/reducer.test.ts` (or a scratch `node --experimental-strip-types` run)

The core is exercisable with no React, no DOM, and no test framework. This is the payoff of keeping the transitions pure.

```ts
import { emptyChatState } from "@/lib/chat/model";
import { createChat, selectChatView, sendDraft, setDraft } from "@/lib/chat/reducer";

let state = createChat(emptyChatState());
state = setDraft(state, "hello");
state = sendDraft(state);

const view = selectChatView(state);
assert(view.kind === "chat");
assert(view.chat.messages.map((m) => m.role).join() === "user,assistant");
assert(view.chat.draft === "");
```

## Shape

The domain is three layers with a one-way dependency chain. `model.ts` (types, no imports) is imported by `reducer.ts` (pure functions, no React) which is imported by `store.tsx` (React only) which is imported by `components/chat/*` (JSX only). Nothing points back up. The reducer is the only place a state transition is written, and the read hooks are the only way a component sees state.

### Types

```ts
// lib/chat/model.ts

/** Branded so `openChat(someMessageId)` cannot compile. */
export type ChatId = string & { readonly __chatId: unique symbol };

export type Role = "user" | "assistant";

export type Message = {
  readonly id: string;
  readonly role: Role;
  readonly text: string;
};

export type Chat = {
  readonly id: ChatId;
  /** Append-only, oldest first. */
  readonly messages: readonly Message[];
  /** Per-chat, so switching threads never loses typed text. */
  readonly draft: string;
};

export type ChatState = {
  /**
   * Most recent activity first. Only `reducer.ts` writes this invariant.
   * The array order *is* the sidebar order. There is no separate sort key.
   */
  readonly chats: readonly Chat[];
  /**
   * May dangle after a delete. Never read directly by a component.
   * `selectChatView` is the single place that resolves it.
   */
  readonly selectedId: ChatId | null;
};

/** What the main pane renders. Exactly one of these is true at a time. */
export type ChatView =
  | { readonly kind: "no-chats" }
  | { readonly kind: "no-selection" }
  | { readonly kind: "chat"; readonly chat: Chat };

/** What the sidebar renders. Already derived, so the component holds no logic. */
export type ChatListRow = {
  readonly id: ChatId;
  readonly title: string;
  readonly isActive: boolean;
};

export function emptyChatState(): ChatState {
  throw new Error("not implemented");
}

/** Two seeded threads for eyeballing the populated layout. Optional. */
export function demoChatState(): ChatState {
  throw new Error("not implemented");
}

/**
 * The brand constructor. One cast, here, and nowhere else.
 * Deterministic counter rather than `crypto.randomUUID()`: the provider renders
 * on the server too, and seeded ids have to match across hydration.
 */
export function nextChatId(): ChatId {
  throw new Error("not implemented");
}
```

Four load-bearing decisions, each of which deletes a class of bug.

**`ChatView` is a sum type, not a nullable chat.** A `Chat | null` plus `chats.length` forces every consumer to re-derive which of the three panes it is looking at, and lets "chat open" and "no chats" both be true. The union makes that unrepresentable and gives the compiler a job when a fourth pane appears, per `type-system-discipline`.

**Ordering is positional, not a timestamp.** No `createdAt` or `updatedAt` anywhere. The chats array is kept most-recent-first by the updaters, so the sidebar renders `state.chats` in order with no sort and no comparator. Two orderings where one is meaningless is exactly the "derive instead of sync" smell that `minimize-reader-load` names. Nothing in the UI displays a time, so the fields would have been dead weight, per `laziness-protocol`.

**Titles are derived, never stored.** `chatTitle(chat)` reads the first user message and truncates, falling back to "New chat". A stored title needs a write on first send, and a write that can be forgotten. Deriving removes the sync point entirely.

**Only `ChatId` is branded.** `Message.id` is a plain string because it never appears in a signature, only as a React key. Branding it would be precision that buys no safety, which `type-system-discipline` calls out explicitly.

### Pure updaters, the reducer, and selectors

Every updater is `(state, args) => ChatState` and returns the same reference when nothing changes.

```ts
// lib/chat/reducer.ts
import type { Chat, ChatId, ChatListRow, ChatState, ChatView, Role } from "./model";

/** Creates an empty chat, puts it at the front, and selects it. */
export function createChat(state: ChatState): ChatState {
  throw new Error("not implemented");
}

export function selectChat(state: ChatState, id: ChatId): ChatState {
  throw new Error("not implemented");
}

/**
 * Removes the chat and repairs the selection so `selectedId` never dangles:
 *   if id !== state.selectedId -> selection unchanged
 *   else                      -> chat that took this index, else the one before, else null
 */
export function deleteChat(state: ChatState, id: ChatId): ChatState {
  throw new Error("not implemented");
}

/** Patches the open chat's draft. Does not reorder. No-op with no selection. */
export function setDraft(state: ChatState, text: string): ChatState {
  throw new Error("not implemented");
}

/**
 * Read-modify-write lives here, not in the caller. That is what lets the
 * command object stay referentially stable.
 *   draft = open chat's draft, trimmed
 *   if no open chat or draft === "" -> return state unchanged
 *   append {role: "user", text: draft}
 *   append {role: "assistant", text: mockReply(draft)}
 *   clear draft, promote chat to front
 */
export function sendDraft(state: ChatState): ChatState {
  throw new Error("not implemented");
}

export type ChatAction =
  | { type: "newChat" }
  | { type: "openChat"; id: ChatId }
  | { type: "deleteChat"; id: ChatId }
  | { type: "setDraft"; text: string }
  | { type: "send" };

/** Exhaustive dispatch table over the updaters. Never imported by a component. */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  throw new Error("not implemented");
}

// --- chat-level helpers, the only writers of the ordering invariant ---

function appendMessage(chat: Chat, role: Role, text: string): Chat {
  throw new Error("not implemented");
}

/** Replaces one chat in place, preserving order. */
function updateChat(
  chats: readonly Chat[],
  id: ChatId,
  update: (chat: Chat) => Chat,
): readonly Chat[] {
  throw new Error("not implemented");
}

/** Moves one chat to the front. The single writer of "most recent first". */
function promoteChat(chats: readonly Chat[], id: ChatId): readonly Chat[] {
  throw new Error("not implemented");
}

/** Deterministic, synchronous, pure. No timers, so there is no async to unwind later. */
function mockReply(userText: string): string {
  throw new Error("not implemented");
}

// --- selectors ---

/**
 * The one place `selectedId` is resolved. A dangling id degrades to
 * "no-selection" instead of crashing:
 *   chats.length === 0            -> {kind: "no-chats"}
 *   selectedId resolves to a chat -> {kind: "chat", chat}
 *   otherwise                     -> {kind: "no-selection"}
 */
export function selectChatView(state: ChatState): ChatView {
  throw new Error("not implemented");
}

export function selectChatList(state: ChatState): readonly ChatListRow[] {
  throw new Error("not implemented");
}

/** First user message, truncated, else "New chat". */
export function chatTitle(chat: Chat): string {
  throw new Error("not implemented");
}
```

### The React binding

```tsx
// lib/chat/store.tsx
"use client";

export type ChatCommands = {
  readonly newChat: () => void;
  readonly openChat: (id: ChatId) => void;
  readonly deleteChat: (id: ChatId) => void;
  readonly setDraft: (text: string) => void;
  readonly send: () => void;
};

export function ChatStoreProvider(props: {
  children: ReactNode;
  /** Defaults to `emptyChatState()`. Pass `demoChatState()` to eyeball a populated layout. */
  initialState?: ChatState;
}) {
  throw new Error("not implemented");
  // useReducer(chatReducer, props.initialState ?? emptyChatState())
  // commands = useMemo(() => ({ newChat: () => dispatch({type:"newChat"}), ... }), [])
  //   -> empty dep array is sound because no command reads state
  // <CommandsContext value={commands}><StateContext value={state}>{children}
}

/** Throws if used outside the provider. The only guard in the module. */
export function useChatView(): ChatView {
  throw new Error("not implemented");
}

export function useChatList(): readonly ChatListRow[] {
  throw new Error("not implemented");
}

export function useChatCommands(): ChatCommands {
  throw new Error("not implemented");
}
```

Two contexts, split on read versus write. The commands context value is created once with an empty dependency array, which is only sound because `sendDraft` reads the draft out of state inside the reducer instead of taking it as an argument. That single decision is what makes the write handle stable, and a stable write handle is what lets the New chat button and any future keyboard shortcut subscribe to nothing. `ChatAction` and `ChatState` are exported from their own modules for tests, but nothing in `components/` imports either one.

### Module map

```
web/
  app/
    page.tsx                          replaced. server component, renders <ChatShell />
    layout.tsx                        touched only to fix the "Create Next App" metadata
    globals.css                       unchanged. --sidebar-* tokens already present
  lib/chat/
    model.ts                          types + emptyChatState/demoChatState/nextChatId
    reducer.ts                        updaters, chatReducer, selectors, mockReply
    store.tsx                         "use client". provider + 3 hooks
  components/chat/
    chat-shell.tsx                    "use client". ChatStoreProvider + SidebarProvider
                                      + <ChatSidebar /> + <SidebarInset><ChatPanel />
    chat-sidebar.tsx                  New chat + thread list. useChatList + useChatCommands
    chat-panel.tsx                    exhaustive ChatView switch. empty panes inline
    message-list.tsx                  renders readonly Message[]. owns the autoscroll effect
    composer.tsx                      Textarea + Send. useChatCommands, draft as a prop
  components/ui/
    sidebar.tsx  separator.tsx  tooltip.tsx  skeleton.tsx   added by shadcn
  hooks/
    use-mobile.ts                     added by shadcn with sidebar
```

Nine files, five of them components under thirty lines. The empty panes stay inline in `chat-panel.tsx` because they are three lines of JSX with one caller, and a file for each would be layer count with no compression.

`chat-shell.tsx` is where the two providers nest and the only `"use client"` boundary the route opens. It carries `h-dvh min-h-0` on `SidebarProvider`, the same thing t3code does, so the shell fits the existing `body` flex column instead of fighting it. The leaves below it inherit the client boundary through the import graph, and marking each one `"use client"` anyway is harmless.

Two behaviors live in the leaves rather than the domain, because they are about the DOM and not about chat state. `message-list.tsx` owns a single effect that scrolls its container to the bottom when `messages.length` changes. A chat that does not follow the conversation reads as broken, so this earns its five lines, per `experience-first`. `composer.tsx` sends on Enter and inserts a newline on Shift+Enter, and disables the send button when the draft is blank. Both call `send()` from `useChatCommands()`, so neither knows what sending does.

### shadcn components to install

```bash
pnpm dlx shadcn@latest add sidebar
```

That is the whole list. `sidebar` pulls `separator`, `tooltip`, `skeleton`, and the `use-mobile` hook, and reuses the `button`, `input`, and `sheet` already on disk. Everything else the design needs (`button`, `textarea`, `card`) is present. No `scroll-area`, because `overflow-y-auto` on the message list does the job. No `dropdown-menu`, because delete is a `SidebarMenuAction` icon button.

### Interface depth

The public surface is one provider, three hooks, and one exported command type. Behind it sit the most-recent-first ordering invariant, selection repair on delete, title derivation, the dangling-id resolution, per-chat draft ownership, and the mock reply. A component author learns five command names and one three-case union, and never learns the action union, the reducer, `selectedId`, or how ordering is maintained. What stays exposed is deliberate. `Chat` and `Message` are visible because the components render them, and `ChatId` is visible because it flows from a list row into `openChat`.

The read hooks are three rather than one because each returns the exact shape one component needs, which is what keeps `chatTitle` and the active-row comparison from being duplicated in JSX. That is the `minimize-reader-load` "name the invariant at the boundary" move.

## Synthesis decision

*(left for arena)*

## Tradeoffs accepted

- We accept a nine-file domain and component split, in exchange for the reader being able to answer "what can change the selected chat?" by reading one file (`reducer.ts`) instead of scanning a component tree for `setState` calls.
- We accept that each named updater has exactly one production caller (its reducer case), in exchange for a domain vocabulary and a pure core that call site 4 exercises with no React. If that stops paying, inline them into the switch; the public surface does not change.
- We accept two contexts, in exchange for a referentially stable command object. Be clear about what this does not buy. The state context value changes on every transition, so all reading components re-render regardless. The split buys a stable write handle and the guarantee that no component can reach raw state, not render isolation.
- We accept a synchronous canned assistant reply computed inside the reducer, in exchange for zero async plumbing. Both roles are visible in the message list on first send, and there is no `setTimeout`, no pending state, and no always-false loading branch to delete when a real backend arrives.
- We accept O(n) chat lookups over a `Map`, in exchange for an array that is directly JSON-serializable and renders in sidebar order with no comparator. At mock-data scale the cost is invisible, and localStorage persistence stays a one-line `JSON.stringify`.
- We accept no timestamps in the model. Adding `createdAt` later is a field plus a formatter, not a restructure, because nothing derives ordering from it.
- We accept one type cast in the codebase, inside `nextChatId`. That is the branded-primitive idiom, validate once at construction and trust the type downstream, and naming it here is better than pretending the brand is free.

## Alternatives considered

**One `ChatWorkspace` client component with `useState` for chats, selection, and draft.** Fewest files, and honestly fine for a week. It loses because the public surface is the entire component tree. Every child either receives setters as props or gets lifted into the parent, so the sidebar ends up holding title derivation and the active comparison, and "most recent first" becomes an inline `.sort()` in JSX. It hides no complexity, which is the shallow-module red flag, and the empty-state logic becomes nested ternaries that permit contradictory renders.

**Context exposing `{ state, dispatch }`.** The obvious reducer wiring, and the one I rejected on interface depth. Exporting `dispatch` exports `ChatAction`, so the action union becomes part of the public surface and every component learns the internal protocol. That is textbook information leakage. Intent-named commands hide the union completely for the same implementation cost.

**A single `useChat()` hook returning state and commands together, no context.** Tempting and smaller. It loses because a chat UI has two consumers of the same state (sidebar and panel) that are siblings, so a hook with local state gives each its own copy. Lifting it back up is the context, so this is the context with extra steps.

**Normalized store, `Record<ChatId, Chat>` plus `messagesByChat` plus an `order` array.** The Redux-shaped answer. It buys O(1) lookup and cheap message updates we do not need, and costs three structures that must stay consistent. Nothing in the requirements edits a message in place, so it is indirection with no branches removed, which `model-the-domain` explicitly warns against.

**`useSyncExternalStore` with selector subscriptions.** The version that would deliver real render isolation. Rejected as premature at five components; it adds a subscription layer whose only payoff is a re-render count nobody can perceive here.

## Open questions and risks

- Does the base-nova registry actually ship `sidebar`? Every primitive on disk is `@base-ui/react`, not Radix, and t3code's own `ui/sidebar.tsx` is a 1043-line base-ui implementation. If `pnpm dlx shadcn@latest add sidebar` does not resolve for this style, do you want the t3code primitives vendored in, or a hand-rolled flex layout using the `sheet` already installed for the mobile drawer? This is one command to settle and should be the first thing checked.
- Should the shell open with a seeded demo thread or an empty slate? The design defaults to empty so the `no-chats` pane is what a reviewer sees first, with `demoChatState()` available as a provider prop. Is that the right first impression?
- Do you want a fake typing delay on the assistant reply? Saying yes changes the shape. It needs an effect, a pending variant on `ChatView`, and a spinner, which is exactly the async plumbing this design excludes on purpose.
- Should New chat reuse an existing empty thread instead of stacking untitled ones? t3-style apps do. It is four lines in `createChat`, but it is a product call about whether the sidebar can accumulate empties.
- Is per-chat draft the behavior you want, or should the composer clear when you switch threads? The model assumes drafts survive switching, which costs nothing and is the friendlier default.

## Next implementation step

Run `pnpm dlx shadcn@latest add sidebar` to confirm base-nova resolves it, then write `lib/chat/model.ts` in full since every other file derives from those types.
