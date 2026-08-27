import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { streamChatEvents } from "@/lib/claude"
import { checkRateLimit } from "@/lib/rate-limit"

function titleFromMessage(message: string): string {
  const collapsed = message.replace(/\s+/g, " ").trim()
  return collapsed.length > 60 ? collapsed.slice(0, 60) + "…" : collapsed || "New chat"
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { message, history, conversationId, images } = await req.json()
  // A photo on its own is a complete message — "what is this?" is implied.
  const attachments = Array.isArray(images) ? images.slice(0, 4) : []
  if (!message && attachments.length === 0) {
    return NextResponse.json({ error: "message is required" }, { status: 400 })
  }

  // Roughly 5MB of base64 per image; beyond that the upstream call fails
  // anyway, and failing here says why.
  for (const img of attachments) {
    if (typeof img?.base64 !== "string" || typeof img?.mediaType !== "string") {
      return NextResponse.json({ error: "bad image payload" }, { status: 400 })
    }
    if (img.base64.length > 7_000_000) {
      return NextResponse.json({ error: "That image is too large — try a smaller photo." }, { status: 413 })
    }
  }

  const userId = session.user.id

  // 20/hr was set when chat was a side panel. It is the main surface now — a
  // briefing plus a few follow-ups is a normal morning — and the ceiling was
  // reachable in one sitting. Still low enough to catch a runaway loop.
  const rl = checkRateLimit(userId, "chat", 80, 60 * 60 * 1000) // 80/hr
  if (!rl.allowed) {
    // resetAt lets the client tell the user *when* they can chat again rather
    // than failing silently; Retry-After is the same number for HTTP clients.
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later.", resetAt: rl.resetAt },
      {
        status: 429,
        headers: { "Retry-After": String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))) },
      }
    )
  }

  // Resolve the conversation: continue an existing one that belongs to this
  // user, or start a new one titled after the first message. Messages from the
  // pre-conversation era ("legacy") can't be appended to — a new conversation
  // is started instead.
  // A photo with no caption is a real message, and it used to be stored as an
  // empty string — a blank row in the transcript, under a conversation called
  // "New chat". Neither says anything about what was actually sent.
  const photoLabel = attachments.length === 1 ? "a photo" : `${attachments.length} photos`
  const titleSource = message || (attachments.length === 1 ? "Photo" : `${attachments.length} photos`)
  const storedContent = message || `[sent ${photoLabel}]`

  let conversation =
    conversationId && conversationId !== "legacy"
      ? await prisma.chatConversation.findFirst({ where: { id: conversationId, userId } }).catch(() => null)
      : null
  if (!conversation) {
    conversation = await prisma.chatConversation.create({
      data: { userId, title: titleFromMessage(titleSource) },
    })
  }
  const convId = conversation.id

  await prisma.chatMessage.create({ data: { userId, conversationId: convId, role: "user", content: storedContent } })

  // Real token streaming — forward Claude's deltas straight to the client as
  // they arrive, then persist the accumulated reply once the stream finishes.
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      // Tell the client which conversation this turn landed in before any text
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ conversationId: convId })}\n\n`))
      let full = ""
      let chips: unknown[] = []
      try {
        // Text is what gets persisted; the tool and sources events are about
        // this turn only — they describe how the answer was reached, so they
        // are streamed to the screen and not written into the transcript.
        for await (const event of streamChatEvents(userId, message ?? "", history ?? [], attachments)) {
          if (event.type === "text") full += event.text
          if (event.type === "sources") chips = event.chips
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }
      } catch {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", text: "\n\n_(Sorry, something went wrong.)_" })}\n\n`))
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      controller.close()
      if (full.trim()) {
        await prisma.chatMessage.create({
          data: {
            userId, conversationId: convId, role: "assistant", content: full,
            sources: chips.length > 0 ? JSON.stringify(chips) : null,
          },
        }).catch(() => {})
      }
      await prisma.chatConversation.update({ where: { id: convId }, data: { updatedAt: new Date() } }).catch(() => {})
    },
  })

  return new NextResponse(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const conversationId = req.nextUrl.searchParams.get("conversation")

  // "legacy" = messages from before conversations existed (no conversationId)
  const where =
    conversationId === "legacy"
      ? { userId, conversationId: null }
      : conversationId
      ? { userId, conversationId }
      : { userId }

  const messages = await prisma.chatMessage.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: conversationId ? 200 : 100,
  })

  return NextResponse.json(messages)
}
