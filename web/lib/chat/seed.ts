import type { ChatUiState } from "./types"

const seedChatId = "chat-new"

export const initialChatUiState: ChatUiState = {
  chats: [
    {
      id: seedChatId,
      title: "New chat",
      messages: [],
    },
  ],
  activeChatId: seedChatId,
  connection: { status: "connecting" },
  activity: { status: "idle" },
}
