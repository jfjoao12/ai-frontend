"use client";

import { useEffect, useRef, useState } from "react";
import AiChatMessage from "./AiChatMessage";
import UserChatMessage from "./UserChatMessage";
import type { ChatMessage } from "./messages";
import { useChat } from "./use-chat";

export default function Chat() {
  const conversationRef = useRef<HTMLElement | null>(null);
  const [input, setInput] = useState("");
  const { messages, isStreaming, error, sendMessage } = useChat();

  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation) {
      conversation.scrollTop = conversation.scrollHeight;
    }
  }, [messages]);

  function submitMessage() {
    const message = input.trim();
    if (!message || isStreaming) return;

    setInput("");
    void sendMessage(message);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitMessage();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitMessage();
    }
  }

  return (
    <main className="flex h-dvh w-full flex-col bg-background font-sans text-foreground">
      <header className="shrink-0 border-b border-foreground/10 px-4 py-5 sm:px-8">
        <h1 className="mx-auto w-full max-w-4xl text-lg font-medium">AI Chat</h1>
      </header>

      <section
        ref={conversationRef}
        aria-label="Conversation"
        role="log"
        aria-live="polite"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8"
      >
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-end gap-3">
          <AiChatMessage text="Hello! Feel free to ask anything about João." />
          {messages.map((message) => (
            <ChatMessageView key={message.id} message={message} />
          ))}
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      </section>

      <div className="shrink-0 px-4 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex w-full max-w-4xl items-end gap-2 rounded-lg border border-foreground/20 bg-foreground/5 p-3 focus-within:ring-2 focus-within:ring-blue-500"
        >
          <textarea
            name="message"
            id="message"
            aria-label="Message"
            placeholder="Ask me anything about João"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            className="min-w-0 flex-1 resize-none bg-transparent outline-none"
            rows={2}
          />
          <button
            type="submit"
            disabled={isStreaming}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-wait disabled:opacity-50"
            aria-label="Send message"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.832a1.5 1.5 0 0 1 0 .986L3.03 20.325a.498.498 0 0 0 .683.627l17-8.5a.5.5 0 0 0 0-.904z" />
              <path d="M6 12h16" />
            </svg>
          </button>
        </form>
      </div>
    </main>
  );
}

function ChatMessageView({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return <UserChatMessage text={message.text} />;
  }

  switch (message.type) {
    case "reasoning_message":
      return (
        <details className="max-w-full self-start text-sm text-foreground/60">
          <summary className="cursor-pointer">Reasoning</summary>
          <p className="mt-2 whitespace-pre-wrap wrap-anywhere">{message.text}</p>
        </details>
      );
    case "tool_call_message":
    case "tool_result_message":
      return (
        <p className="max-w-full self-start text-sm text-foreground/60 wrap-anywhere">
          {message.text}
        </p>
      );
    default:
      return <AiChatMessage text={message.text} />;
  }
}
