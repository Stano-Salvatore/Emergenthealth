import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { streamChatResponse } from "@/lib/claude"
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

  const rl = checkRateLimit(userId, "chat", 20, 60 * 60 * 1000) // 20/hr
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
  const titleSource = message || "Photo"
  let conversation =
    conversationId && conversationId !== "legacy"
      ? await prisma.chatConversation.findFirst({ where: { id: conversationId, userId } }).catch(() => null)
      : null
  if (!conversation) {
    conversation = await prisma.chatConversation.create({
      data: { userId, title: titleFromMessage(message) },
    })
  }
  const convId = conversation.id

  await prisma.chatMessage.create({ data: { userId, conversationId: convId, role: "user", content: message } })

  // Real token streaming — forward Claude's deltas straight to the client as
  // they arrive, then persist the accumulated reply once the stream finishes.
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      // Tell the client which conversation this turn landed in before any text
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ conversationId: convId })}\n\n`))
      let full = ""
      try {
        for await (const chunk of streamChatResponse(userId, message ?? "", history ?? [], attachments)) {
          full += chunk
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
        }
      } catch {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: "\n\n_(Sorry, something went wrong.)_" })}\n\n`))
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      controller.close()
      if (full.trim()) {
        await prisma.chatMessage.create({ data: { userId, conversationId: convId, role: "assistant", content: full } }).catch(() => {})
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
