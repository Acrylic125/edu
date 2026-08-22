# Candidate 1: one state owner, prop-only views

## Problem

Build a UI-only chat shell that replaces the default Next.js page. The shell needs the layout silhouette from t3code without its thread orchestration, persistence, or backend machinery. One client component owns all mutable state. Small presentational components render the sidebar, empty state, messages, and composer from props.

## Usage

The route stays a server component. It imports one client entry point.

```tsx
// app/page.tsx
import { ChatWorkspace } from "@/components/chat/chat-workspace";

export default function Home() {
	return <ChatWorkspace />;
}
```

`ChatWorkspace` owns the chat collection, the selected chat, and the composer draft. Its children receive values and event callbacks only.

```tsx
// components/chat/chat-workspace.tsx
"use client";

import { useMemo, useState } from "react";
import { ChatMain } from "@/components/chat/chat-main";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { getSelectedChat, initialChatState } from "@/lib/chat-state";

export function ChatWorkspace() {
	const [state, setState] = useState(initialChatState);
	const [draft, setDraft] = useState("");
	const selectedChat = useMemo(() => getSelectedChat(state), [state]);

	return (
		<AppSidebarLayout
			sidebar={
				<ChatSidebar
					chats={state.chats}
					selectedChatId={state.selectedChatId}
					onNewChat={handleNewChat}
					onSelectChat={handleSelectChat}
				/>
			}
		>
			<ChatMain
				chat={selectedChat}
				draft={draft}
				onDraftChange={setDraft}
				onSend={handleSend}
				onNewChat={handleNewChat}
			/>
		</AppSidebarLayout>
	);
}
```

Event handlers generate IDs and timestamps at the React boundary. Pure updaters receive those values and return the next state.

```tsx
function handleNewChat() {
	setState((current) =>
		createChat(current, {
			id: crypto.randomUUID(),
			createdAt: Date.now(),
		}),
	);
	setDraft("");
}

function handleSelectChat(chatId: ChatId) {
	setState((current) => selectChat(current, chatId));
	setDraft("");
}

function handleSend() {
	const text = draft.trim();
	const chatId = state.selectedChatId;

	if (!text || chatId === null) {
		return;
	}

	setState((current) =>
		appendMessage(current, {
			chatId,
			message: {
				id: crypto.randomUUID(),
				role: "user",
				text,
				createdAt: Date.now(),
			},
		}),
	);
	setDraft("");
}
```

The presentational sidebar has no chat rules. It only reports user intent.

```tsx
<ChatSidebar
	chats={state.chats}
	selectedChatId={state.selectedChatId}
	onNewChat={() => createLocalChat()}
	onSelectChat={(chatId) => selectLocalChat(chatId)}
/>
```

## Shape

### Data structures

The local dataset is small, ordered, and replaced as one value. An array keeps rendering and update order visible. A normalized store or reducer would add indirection without solving a current problem.

```ts
export type ChatId = string;
export type MessageId = string;
export type MessageRole = "user" | "assistant";

export type Message = {
	readonly id: MessageId;
	readonly role: MessageRole;
	readonly text: string;
	readonly createdAt: number;
};

export type Chat = {
	readonly id: ChatId;
	readonly title: string;
	readonly messages: readonly Message[];
	readonly createdAt: number;
	readonly updatedAt: number;
};

export type ChatState = {
	readonly chats: readonly Chat[];
	readonly selectedChatId: ChatId | null;
};

export type CreateChatInput = {
	readonly id: ChatId;
	readonly createdAt: number;
};

export type AppendMessageInput = {
	readonly chatId: ChatId;
	readonly message: Message;
};
```

`selectedChatId: null` is the only no-selection state. Messages carry raw text and a closed role union. The React boundary creates IDs and timestamps because those operations are not pure. The state module owns chat ordering, fallback titles, and selection validity.

### Pure state operations

```ts
export const initialChatState: ChatState = {
	chats: [],
	selectedChatId: null,
};

export function createChat(
	state: ChatState,
	input: CreateChatInput,
): ChatState {
	throw new Error("not implemented");
}

export function selectChat(
	state: ChatState,
	chatId: ChatId,
): ChatState {
	throw new Error("not implemented");
}

export function appendMessage(
	state: ChatState,
	input: AppendMessageInput,
): ChatState {
	throw new Error("not implemented");
}

export function getSelectedChat(state: ChatState): Chat | null {
	throw new Error("not implemented");
}
```

`createChat` prepends an empty chat titled `"New chat"` and selects it. `selectChat` returns the existing state when the ID is unknown. `appendMessage` follows this pseudocode:

```text
trim the message text
return the same state if the text is empty or the chat ID is unknown
append the message to the matching chat
derive the title from the first user message if the title is still "New chat"
set updatedAt from the message timestamp
move the updated chat to the front
preserve the current selection
```

The updater set is intentionally small. There is no delete, rename, persistence, streaming, or simulated assistant response because no visible control needs those operations.

### Component signatures

```tsx
export function AppSidebarLayout(props: {
	readonly sidebar: React.ReactNode;
	readonly children: React.ReactNode;
}): React.ReactNode {
	throw new Error("not implemented");
}

export function ChatSidebar(props: {
	readonly chats: readonly Chat[];
	readonly selectedChatId: ChatId | null;
	readonly onNewChat: () => void;
	readonly onSelectChat: (chatId: ChatId) => void;
}): React.ReactNode {
	throw new Error("not implemented");
}

export function ChatMain(props: {
	readonly chat: Chat | null;
	readonly draft: string;
	readonly onDraftChange: (value: string) => void;
	readonly onSend: () => void;
	readonly onNewChat: () => void;
}): React.ReactNode {
	throw new Error("not implemented");
}

export function MessageList(props: {
	readonly messages: readonly Message[];
}): React.ReactNode {
	throw new Error("not implemented");
}

export function ChatComposer(props: {
	readonly value: string;
	readonly disabled: boolean;
	readonly onChange: (value: string) => void;
	readonly onSubmit: () => void;
}): React.ReactNode {
	throw new Error("not implemented");
}
```

`ChatMain` renders the pick-or-create empty state when `chat` is `null`. A selected chat renders `MessageList` and the controlled `ChatComposer`. Message rows use plain text nodes with `whitespace-pre-wrap`; they do not parse Markdown or HTML.

The only stateful public component is `ChatWorkspace`. The views expose a few event callbacks and hide ShadCN layout details, title derivation, ordering, and immutable updates. The boundary is deep enough for this feature without introducing a context provider, store, or reducer.

### Module map

```text
web/
	app/
		page.tsx
	components/
		chat/
			app-sidebar-layout.tsx
			chat-composer.tsx
			chat-main.tsx
			chat-sidebar.tsx
			chat-workspace.tsx
			message-list.tsx
		ui/
			sidebar.tsx
			separator.tsx
			skeleton.tsx
			tooltip.tsx
	lib/
		chat-state.ts
```

`app/page.tsx` selects the feature entry point. `chat-workspace.tsx` owns React state and event adaptation. `chat-state.ts` owns the chat model and every state transition. The remaining chat files only render props.

### ShadCN components

Install the generated sidebar and its support components:

```sh
pnpm exec shadcn add sidebar separator tooltip skeleton
```

Use the existing `button`, `textarea`, and `sheet` components. The generated `sidebar` may reuse the existing `input`. `AppSidebarLayout` composes `SidebarProvider`, `Sidebar`, `SidebarInset`, `SidebarTrigger`, and `Separator`.

## Synthesis decision

## Tradeoffs accepted

- We accept array scans and immutable array copies in exchange for a direct model suited to a small mock thread list.
- We accept ephemeral state on refresh in exchange for keeping the shell free of storage and hydration policy.
- We accept plain string IDs in exchange for avoiding constructors and casts in a local-only prototype.
- We accept one state owner that re-renders the workspace in exchange for obvious ownership and no context or store setup.
- We accept separate files for visible UI regions in exchange for keeping each prop-only view easy to replace during visual iteration.

## Alternatives considered

- A `useReducer` command model would gather dispatch into one function, but callers would need to learn action objects while the reducer hid no more policy than four pure functions.
- React context plus thread and composer hooks would expose more interfaces and spread state ownership across files. It would only pay off if unrelated routes or distant descendants needed chat state.
- A normalized `Record<ChatId, Chat>` plus an ordered ID list would improve large-list lookup, but every caller would need to coordinate two collections. The mock list does not justify that exposed invariant.
- One monolithic `page.tsx` would minimize file count, but it would mix ShadCN layout, state rules, and message rendering. A reader could not change one visual region without reading the whole feature.

## Open questions and risks

- Should the initial state stay empty, or should implementation include two static chats to make the shell visually populated on first load?
- Should pressing Enter submit while Shift+Enter inserts a newline, or should submission require the Send button?
- Should a newly created empty chat remain in the list if the user selects another chat without sending a message?
- Does the sidebar need a collapsible icon rail on desktop, or is mobile sheet behavior plus a fixed desktop width enough for this first shell?
- Will later local persistence need stable versioned parsing, or can that requirement redesign `chat-state.ts` when it arrives?

## Next implementation step

Add the ShadCN sidebar components, then implement `chat-state.ts` and its updater tests before filling in the React bodies.
