export function isLatestChatMessage(
  messageId: string,
  lastMessageId: string | undefined,
) {
  return lastMessageId !== undefined && messageId === lastMessageId
}
