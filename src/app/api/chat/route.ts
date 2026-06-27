import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { streamChatResponse } from "@/lib/claude"
import { checkRateLimit } from "@/lib/rate-limit"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { message, history } = await req.json()
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 })

  const userId = session.user.id

  const rl = checkRateLimit(userId, "chat", 20, 60 * 60 * 1000) // 20/hr
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later.", resetAt: rl.resetAt },
      { status: 429 }
    )
  }

  await prisma.chatMessage.create({ data: { userId, role: "user", content: message } })

  // Real token streaming — forward Claude's deltas straight to the client as
  // they arrive, then persist the accumulated reply once the stream finishes.
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      let full = ""
      try {
        for await (const chunk of streamChatResponse(userId, message, history ?? [])) {
          full += chunk
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
        }
      } catch {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: "\n\n_(Sorry, something went wrong.)_" })}\n\n`))
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      controller.close()
      if (full.trim()) {
        await prisma.chatMessage.create({ data: { userId, role: "assistant", content: full } }).catch(() => {})
      }
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

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const messages = await prisma.chatMessage.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    take: 100,
  })

  return NextResponse.json(messages)
}
