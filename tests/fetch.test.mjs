import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadTypeScript(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

const { default: streamChat } = await loadTypeScript("../src/lib/fetch.ts");
const { POST } = await loadTypeScript("../src/app/api/chat/route.ts");
const { applyStreamEvent } = await loadTypeScript("../src/app/chat/messages.ts");
const encoder = new TextEncoder();
const event = (message, type = "ai_message", id = "message-1") => ({
  id, type, message, status: "streaming",
});
const frame = (data) => `data: ${JSON.stringify(data)}\n\n`;
const collect = async (stream) => {
  const events = [];
  for await (const item of stream) events.push(item);
  return events;
};

function streamResponse(text, chunkSize = 7) {
  const bytes = encoder.encode(text);
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  }), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}

test("yields the first event while the response is still open", { timeout: 2000 }, async (t) => {
  let controller;
  const body = new ReadableStream({ start(value) { controller = value; } });
  t.mock.method(globalThis, "fetch", async () => new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  }));

  const stream = streamChat("Hello", "thread-1");
  const first = stream.next();
  controller.enqueue(encoder.encode(frame(event("Hello"))));
  assert.deepEqual(await first, { done: false, value: event("Hello") });

  const second = stream.next();
  controller.enqueue(encoder.encode(frame(event(" world"))));
  assert.deepEqual(await second, { done: false, value: event(" world") });
  controller.close();
  assert.equal((await stream.next()).done, true);
});

test("posts message and threadId, forwarding cancellation", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/chat");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { message: "Hello", threadId: "thread-1" });
    assert.equal(options.headers.Accept, "text/event-stream");
    assert.equal(options.signal, controller.signal);
    assert.equal(options.cache, "no-store");
    return streamResponse(frame(event("Hi")));
  });
  assert.deepEqual(await collect(streamChat("Hello", "thread-1", controller.signal)), [event("Hi")]);
});

test("decodes split UTF-8, CRLF boundaries, and every backend message type", async (t) => {
  const events = [
    event("Olá, João 👋"),
    event("Thinking", "reasoning_message"),
    event("Fetching documents", "tool_call_message", "tool-1"),
    event("Documents found", "tool_result_message", "tool-1"),
    { ...event(""), status: "finished" },
  ];
  const text = ": heartbeat\n\n" + events.map(frame).join("");
  t.mock.method(globalThis, "fetch", async () => streamResponse(text.replaceAll("\n", "\r\n"), 1));
  assert.deepEqual(await collect(streamChat("Hello", "thread")), events);
});

test("reads multiple data lines and a final frame without a delimiter", async (t) => {
  const text = 'data: {"id":"1","type":"ai_message",\ndata: "message":"Hi","status":"streaming"}';
  t.mock.method(globalThis, "fetch", async () => streamResponse(text));
  assert.deepEqual(await collect(streamChat("Hello", "thread")), [event("Hi", "ai_message", "1")]);
});

test("preserves partial events before surfacing a named SSE error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => streamResponse(
    frame(event("Partial")) + 'event: error\ndata: {"message":"Stream interrupted"}\n\n',
  ));
  const stream = streamChat("Hello", "thread");
  assert.equal((await stream.next()).value.message, "Partial");
  await assert.rejects(stream.next(), /Stream interrupted/);
});

test("surfaces schema error events and error statuses", async (t) => {
  const errors = [
    { ...event("Agent failed", "error"), status: "error" },
    { ...event("Tool failed", "tool_call_message"), status: "error" },
  ];
  t.mock.method(globalThis, "fetch", async () => streamResponse(frame(errors.shift())));
  await assert.rejects(collect(streamChat("Hello", "thread")), /Agent failed/);
  await assert.rejects(collect(streamChat("Hello", "thread")), /Tool failed/);
});

test("rejects HTTP failures, non-SSE responses, and malformed events", async (t) => {
  const responses = [
    new Response("unavailable", { status: 503 }),
    new Response("{}", { headers: { "Content-Type": "application/json" } }),
    streamResponse("data: not JSON\n\n"),
    streamResponse(frame({ message: "Missing fields" })),
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift());
  await assert.rejects(collect(streamChat("Hello", "thread")), /HTTP 503/);
  await assert.rejects(collect(streamChat("Hello", "thread")), /did not return an SSE response/);
  await assert.rejects(collect(streamChat("Hello", "thread")), SyntaxError);
  await assert.rejects(collect(streamChat("Hello", "thread")), /invalid stream event/);
});

test("cancels the response when the consumer stops reading", async (t) => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(frame(event("Hi")))); },
    cancel() { cancelled = true; },
  });
  t.mock.method(globalThis, "fetch", async () => new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  }));
  const stream = streamChat("Hello", "thread");
  await stream.next();
  await stream.return();
  // pipeThrough propagates cancellation to its source asynchronously.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test("validates inputs before fetching", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected fetch"); });
  for (const message of ["", " ", "a".repeat(8001), null]) {
    await assert.rejects(collect(streamChat(message, "thread")), TypeError);
  }
  await assert.rejects(collect(streamChat("Hello", "")), TypeError);
  assert.equal(mock.mock.callCount(), 0);
});

const request = (body) => new Request("http://localhost/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("proxy relays a first chunk before the backend closes", { timeout: 2000 }, async (t) => {
  let controller;
  const upstream = new ReadableStream({ start(value) { controller = value; } });
  const req = request({ message: "Hello", threadId: "thread-1" });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, process.env.AI_CHAT_ENDPOINT ?? "http://localhost:3010/ai/chat");
    assert.deepEqual(JSON.parse(options.body), { message: "Hello", threadId: "thread-1" });
    assert.equal(options.signal, req.signal);
    return new Response(upstream, { headers: {
      "Content-Type": "text/event-stream", "X-Thread-Id": "thread-1",
    } });
  });

  const response = await POST(req);
  assert.equal(response.headers.get("X-Thread-Id"), "thread-1");
  assert.equal(response.headers.get("X-Accel-Buffering"), "no");
  const reader = response.body.getReader();
  const first = reader.read();
  controller.enqueue(encoder.encode(frame(event("First"))));
  assert.equal(new TextDecoder().decode((await first).value), frame(event("First")));
  controller.close();
  assert.equal((await reader.read()).done, true);
});

test("proxy rejects invalid input and preserves backend HTTP errors", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => new Response("invalid message", { status: 400 }));
  assert.equal((await POST(request({ message: "", threadId: "thread" }))).status, 400);
  assert.equal(mock.mock.callCount(), 0);
  const response = await POST(request({ message: "Hello", threadId: "thread" }));
  assert.equal(response.status, 400);
  assert.equal(await response.text(), "invalid message");
});

test("proxy reports an unreachable backend", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("fetch failed"); });
  assert.equal((await POST(request({ message: "Hello", threadId: "thread" }))).status, 502);
});

test("keeps interleaved answer, reasoning, and tool updates in separate messages", () => {
  const initialMessages = [
    { id: "turn-1", role: "user", text: "What has João built?" },
    { id: "turn-1:pending", role: "assistant", text: "Generating" },
  ];
  const events = [
    event("Checking ", "reasoning_message"),
    event("Fetching documents", "tool_call_message", "tool-1"),
    event("his projects", "reasoning_message"),
    event("Reading documents", "tool_call_message", "tool-1"),
    event("He built "),
    event("a chatbot."),
    event("Found projects", "tool_result_message", "tool-1"),
  ];

  const messages = events.reduce(
    (messages, event) => applyStreamEvent(messages, event, "turn-1"),
    initialMessages,
  );

  assert.deepEqual(messages.map(({ type, text }) => ({ type, text })), [
    { type: undefined, text: "What has João built?" },
    { type: "reasoning_message", text: "Checking his projects" },
    { type: "tool_call_message", text: "Reading documents" },
    { type: "ai_message", text: "He built a chatbot." },
    { type: "tool_result_message", text: "Found projects" },
  ]);
  assert.equal(initialMessages.length, 2);
  assert.equal(initialMessages[1].text, "Generating");
});

test("does not merge replies from different turns when the backend reuses an ID", () => {
  let messages = applyStreamEvent([], event("First answer"), "turn-1");
  messages = applyStreamEvent(messages, event("Second"), "turn-2");
  messages = applyStreamEvent(messages, event(" answer"), "turn-2");

  assert.deepEqual(messages.map((message) => message.text), ["First answer", "Second answer"]);
});
