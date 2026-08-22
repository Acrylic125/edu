import type { ChatUiState } from "./types"

export const initialChatUiState: ChatUiState = {
  chats: [
    {
      id: "chat-linear-algebra",
      title: "Linear algebra review",
      messages: [
        {
          id: "msg-la-1",
          role: "user",
          content: "What's a simple way to think about eigenvectors?",
        },
        {
          id: "msg-la-2",
          role: "assistant",
          content:
            "Directions that a linear map only stretches or shrinks, without rotating.",
        },
        {
          id: "msg-la-3",
          role: "user",
          content: "And the eigenvalue is the stretch factor?",
        },
        {
          id: "msg-la-4",
          role: "assistant",
          content: "Yes. That's the scalar along that direction.",
        },
        {
          id: "msg-la-5",
          role: "user",
          content: "Can you give a 2D picture?",
        },
        {
          id: "msg-la-6",
          role: "assistant",
          content:
            "Think of a shear that leaves the x-axis alone. That axis is an eigenspace.",
        },
        {
          id: "msg-la-7",
          role: "user",
          content: "What about degenerate cases?",
        },
        {
          id: "msg-la-8",
          role: "assistant",
          content:
            "If every vector is an eigenvector, the map is just scaling. Boring, but allowed.",
        },
        {
          id: "msg-la-9",
          role: "user",
          content: "And if there are none over the reals?",
        },
        {
          id: "msg-la-10",
          role: "assistant",
          content:
            "Rotations in 2D. Complex eigenvalues show up. Extend the field or accept none.",
        },
        {
          id: "msg-la-11",
          role: "user",
          content: "How does this connect to diagonalization?",
        },
        {
          id: "msg-la-12",
          role: "assistant",
          content:
            "A basis of eigenvectors turns the map into a diagonal matrix of eigenvalues.",
        },
      ],
    },
    {
      id: "chat-essay",
      title: "Essay outline help",
      messages: [
        {
          id: "msg-essay-1",
          role: "user",
          content: "Help me outline a short essay on photosynthesis.",
        },
        {
          id: "msg-essay-2",
          role: "assistant",
          content:
            "Claim, light reactions, Calvin cycle, then why it matters for energy flow.",
        },
      ],
    },
    {
      id: "chat-empty",
      title: "New chat",
      messages: [],
    },
  ],
  activeChatId: "chat-linear-algebra",
}
