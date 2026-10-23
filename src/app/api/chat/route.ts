type ChatRequestBody = {
  message: string;
  threadId: string;
};

const MAX_MESSAGE_LENGTH = 8000;
const DEFAULT_CHAT_ENDPOINT = "http://localhost:3010/ai/chat";

function isChatRequestBody(body: unknown): body is ChatRequestBody {
  if (typeof body !== "object" || body === null) return false;
  if (!("message" in body) || typeof body.message !== "string") return false;
  if (!body.message.trim() || body.message.length > MAX_MESSAGE_LENGTH) return false;
  if (!("threadId" in body) || typeof body.threadId !== "string") return false;

  return body.threadId.trim().length > 0;
}

/** Forward the stream unchanged so the browser receives events immediately. */
export async function POST(request: Request): Promise<Response> {
  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return Response.json({ message: "Invalid JSON request." }, { status: 400 });
  }

  if (!isChatRequestBody(requestBody)) {
    return Response.json({ message: "A message and threadId are required." }, { status: 400 });
  }

  try {
    const endpoint = process.env.AI_CHAT_ENDPOINT ?? DEFAULT_CHAT_ENDPOINT;
    const backendResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        message: requestBody.message,
        threadId: requestBody.threadId,
      }),
      signal: request.signal,
      cache: "no-store",
    });

    const contentType = backendResponse.headers.get("content-type");

    if (!backendResponse.ok) {
      return new Response(backendResponse.body, {
        status: backendResponse.status,
        headers: { "Content-Type": contentType ?? "text/plain" },
      });
    }

    if (!backendResponse.body || !contentType?.includes("text/event-stream")) {
      await backendResponse.body?.cancel();
      return Response.json({ message: "Backend did not return an SSE stream." }, { status: 502 });
    }

    const headers = new Headers({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    });
    const threadId = backendResponse.headers.get("x-thread-id");
    if (threadId) headers.set("X-Thread-Id", threadId);

    return new Response(backendResponse.body, { headers });
  } catch (error) {
    if (request.signal.aborted) throw error;
    return Response.json({ message: "Unable to connect to the chat backend." }, { status: 502 });
  }
}
