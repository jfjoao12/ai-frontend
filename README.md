# AI Frontend

Full-page chat UI ported from `jfjoao12/rag-chatbot`. The original greeting,
per-conversation session ID, and keyboard controls are preserved.
Assistant replies now appear incrementally as the backend streams them.

## Development

```bash
npm ci
npm run dev
```

Open http://localhost:3000. Run the adjacent `ai-backend` on port 3010
(`PORT=3010 npm run start:dev` from its directory), or set its full chat endpoint
in this project's `.env.local`:

```dotenv
AI_CHAT_ENDPOINT=http://localhost:3010/ai/chat
```

`src/lib/fetch.ts` exports `streamChat(message, threadId, signal?)`, an async
generator that yields each `{ id, type, message, status }` SSE event immediately.
The chat consumes it with `for await` and appends assistant chunks by message ID.
Reasoning appears in collapsible sections; tool progress appears as status text.

The chat files separate the layout (`chat.tsx`), conversation state and request
lifecycle (`use-chat.ts`), and message updates (`messages.ts`).

`src/app/api/chat/route.ts` forwards `{ message, threadId }` to the configured
backend and returns its response body without buffering. The endpoint stays
server-side, so the browser needs no cross-origin API access. No new dependencies
or backend changes are needed.

Stream closure finishes the turn; the backend does not need to emit a separate
finished event. HTTP, protocol, and stream errors appear in the chat, preserving
any partial reply. Navigation is not inferred from text: the current backend
schema does not emit redirect events. Sends are serialized while streaming,
and leaving the page cancels the active browser request. Requests are not retried
automatically because each POST advances the conversation.

```bash
npm test
npm run build
```
