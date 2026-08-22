# Chat UI design synthesis

[Arena design candidate A](0d9bec7a-c873-40cc-91ab-8de0471448cd) wrote `candidate-1/DESIGN.md` (one state owner, prop-only views). Base matches candidate 1. Implementation already shipped on that shape.

[Arena design candidate B](7091f1a6-d155-476c-847c-97258f2d0183) wrote `candidate-2/DESIGN.md` later (reducer + command/read store). Not adopted for this pass.

## Rubric

1. Named domain types for chats and raw text messages
2. t3code silhouette: sidebar list + new chat, inset messages + composer
3. Local mock state only
4. ShadCN sidebar primitives
5. Small mount surface from `app/page.tsx`

## Base pick

**Monolith shell + pure updaters** (candidate-1 shape).

`ChatWorkspace` owns `useState<ChatUiState>`. Presentational children take props. Pure functions in `lib/chat/state.ts` apply create / select / send.

## Grafts

From candidate 2, already applied: pure updaters with intent-named operations (`createChat`, `selectChat`, `sendMessage`), no exported `dispatch` / action union.

Deferred (not worth rewriting the working shell): `ChatView` three-case sum type, split read/command hooks, titles derived-only with no stored title field.

## Rejected

- Full ChatStore provider and `useChatCommands` surface: more reader load for one page (laziness-protocol)
- Route-per-chat: out of scope for UI-only mock
- Porting t3code Sidebar/ChatView: too much IDE chrome
- Rewriting the shipped UI onto candidate 2 after verify passed: churn without a second consumer

## Module map

```
web/lib/chat/types.ts
web/lib/chat/state.ts
web/lib/chat/seed.ts
web/components/chat/chat-workspace.tsx
web/components/chat/chat-sidebar.tsx
web/components/chat/chat-main.tsx
web/components/chat/message-list.tsx
web/components/chat/chat-composer.tsx
web/app/page.tsx
```

## Types

```ts
type ChatId = string
type MessageId = string
type MessageRole = "user" | "assistant"

type ChatMessage = {
  id: MessageId
  role: MessageRole
  content: string
}

type Chat = {
  id: ChatId
  title: string
  messages: ChatMessage[]
}

type ChatUiState = {
  chats: Chat[]
  activeChatId: ChatId | null
}
```

## Usage

```tsx
// app/page.tsx
import { ChatWorkspace } from "@/components/chat/chat-workspace"

export default function Home() {
  return <ChatWorkspace />
}
```
