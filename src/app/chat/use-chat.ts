"use client";

import { useEffect, useRef, useState } from "react";
import streamChat from "@/lib/fetch";
import { applyStreamEvent, type ChatMessage } from "./messages";

export function useChat() {
  const threadIdRef = useRef<string | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => activeRequestRef.current?.abort();
  }, []);

  async function sendMessage(input: string) {
    const message = input.trim();
    if (!message || activeRequestRef.current) return;

    if (!threadIdRef.current) {
      threadIdRef.current =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);
    }

    const controller = new AbortController();
    const turnId = crypto.randomUUID();
    const pendingMessageId = `${turnId}:pending`;

    activeRequestRef.current = controller;
    setError(null);
    setIsStreaming(true);
    setMessages((previousMessages) => [
      ...previousMessages,
      { id: turnId, role: "user", text: message },
      { id: pendingMessageId, role: "assistant", text: "Generating" },
    ]);

    try {
      for await (const event of streamChat(message, threadIdRef.current, controller.signal)) {
        setMessages((previousMessages) => applyStreamEvent(previousMessages, event, turnId));
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(error instanceof Error ? error.message : "Chat stream failed.");
      }
    } finally {
      activeRequestRef.current = null;
      setIsStreaming(false);
      setMessages((previousMessages) =>
        previousMessages.filter((message) => message.id !== pendingMessageId),
      );
    }
  }

  return { messages, isStreaming, error, sendMessage };
}
