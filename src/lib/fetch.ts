export type ChatStreamEvent = {
  id: string;
  type:
    | "ai_message"
    | "reasoning_message"
    | "tool_call_message"
    | "tool_result_message"
    | "error";
  message: string;
  status: "streaming" | "finished" | "error";
};

const MAX_MESSAGE_LENGTH = 8000;
const SSE_FRAME_DELIMITER = /\r?\n\r?\n/;
const MESSAGE_EVENT_TYPES = [
  "ai_message",
  "reasoning_message",
  "tool_call_message",
  "tool_result_message",
];

function isChatStreamEvent(data: Record<string, unknown>): data is ChatStreamEvent {
  if (typeof data.id !== "string") return false;
  if (typeof data.message !== "string") return false;
  if (typeof data.type !== "string") return false;
  if (!MESSAGE_EVENT_TYPES.includes(data.type)) return false;

  return data.status === "streaming" || data.status === "finished";
}

function parseSseFrame(frame: string): ChatStreamEvent | undefined {
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }

  // Comments and heartbeat frames have no data to deliver.
  if (dataLines.length === 0) return;

  const parsedData: unknown = JSON.parse(dataLines.join("\n"));
  if (typeof parsedData !== "object" || parsedData === null) {
    throw new Error("Chat API returned an invalid stream event.");
  }

  const data = parsedData as Record<string, unknown>;
  const isErrorEvent =
    eventName === "error" || data.type === "error" || data.status === "error";

  if (isErrorEvent) {
    const errorMessage = typeof data.message === "string"
      ? data.message
      : "Chat stream failed.";
    throw new Error(errorMessage);
  }

  if (!isChatStreamEvent(data)) {
    throw new Error("Chat API returned an invalid stream event.");
  }

  return data;
}

/** Yield each backend event as soon as its SSE frame arrives. */
export default async function* streamChat(
  message: string,
  threadId: string,
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const hasValidMessage =
    typeof message === "string" &&
    message.trim().length > 0 &&
    message.length <= MAX_MESSAGE_LENGTH;

  if (!hasValidMessage) {
    throw new TypeError("Message must contain between 1 and 8000 characters.");
  }

  if (typeof threadId !== "string" || !threadId.trim()) {
    throw new TypeError("A conversation thread ID is required.");
  }

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ message, threadId }),
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Chat request failed (HTTP ${response.status}).`);
  }

  const contentType = response.headers.get("content-type");
  if (!contentType?.includes("text/event-stream") || !response.body) {
    await response.body?.cancel();
    throw new Error("Chat API did not return an SSE response.");
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pendingText = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pendingText += value;

      // Keep incomplete frames until the next network chunk arrives.
      while (true) {
        const boundary = SSE_FRAME_DELIMITER.exec(pendingText);
        if (!boundary) break;

        const frame = pendingText.slice(0, boundary.index);
        pendingText = pendingText.slice(boundary.index + boundary[0].length);

        const event = parseSseFrame(frame);
        if (event) yield event;
      }
    }

    // The backend may close without a blank line after its final event.
    if (pendingText.trim()) {
      const event = parseSseFrame(pendingText);
      if (event) yield event;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
