import { LearningWorkspace } from "@/components/chat/learning-workspace"
import { loadChatBootstrap } from "@/lib/chat/load-bootstrap"

export default async function ChatPage({ params }: PageProps<"/chat/[chatId]">) {
  const { chatId } = await params
  const bootstrap = await loadChatBootstrap(chatId)
  return <LearningWorkspace key={chatId} bootstrap={bootstrap} />
}
