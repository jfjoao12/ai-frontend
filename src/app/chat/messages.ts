import type { ChatStreamEvent } from "@/lib/fetch";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  type?: ChatStreamEvent["type"];
  text: string;
};

export function applyStreamEvent(
  messages: ChatMessage[],
  event: ChatStreamEvent,
  turnId: string,
): ChatMessage[] {
  const pendingMessageId = `${turnId}:pending`;
  const messageId = `${turnId}:${event.type}:${event.id}`;
  const updatedMessages = messages.filter((message) => message.id !== pendingMessageId);
  const messageIndex = updatedMessages.findIndex((message) => message.id === messageId);

  if (messageIndex === -1) {
    return [
      ...updatedMessages,
      { id: messageId, role: "assistant", type: event.type, text: event.message },
    ];
  }

  const existingMessage = updatedMessages[messageIndex];

  // Tool progress is a new status; assistant text and reasoning arrive as deltas.
  const text = event.type === "tool_call_message"
    ? event.message
    : existingMessage.text + event.message;

  updatedMessages[messageIndex] = { ...existingMessage, text };
  return updatedMessages;
}
