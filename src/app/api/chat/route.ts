import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { streamChatResponse } from "@/lib/claude"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { message, history } = await req.json()
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 })

  const userId = session.user.id

  await prisma.chatMessage.create({ data: { userId, role: "user", content: message } })

  const fullResponse = await streamChatResponse(userId, message, history ?? [])

  await prisma.chatMessage.create({ data: { userId, role: "assistant", content: fullResponse } })

  // Stream word-by-word for a natural feel
  const words = fullResponse.split(" ")
  const readable = new ReadableStream({
    async start(controller) {
      for (let i = 0; i < words.length; i++) {
        const chunk = (i === 0 ? "" : " ") + words[i]
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
        await new Promise((r) => setTimeout(r, 15))
      }
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
      controller.close()
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
