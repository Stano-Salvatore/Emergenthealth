import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// List the user's chat conversations, newest activity first. Messages sent
// before conversations existed are surfaced as a single "legacy" entry.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const [conversations, legacyLatest] = await Promise.all([
    prisma.chatConversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: { id: true, title: true, updatedAt: true },
    }).catch(() => []),
    prisma.chatMessage.findFirst({
      where: { userId, conversationId: null },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }).catch(() => null),
  ])

  // A conversation with no user message in it is one Emergy started (a
  // proactive say) that nobody has answered yet — the chat page opens on the
  // newest of those rather than a blank screen, so his question is actually
  // in front of the person it was for.
  const ids = conversations.map(c => c.id)
  const replied = ids.length > 0
    ? await prisma.chatMessage.groupBy({
        by: ["conversationId"],
        where: { userId, conversationId: { in: ids }, role: "user" },
      }).catch(() => [] as { conversationId: string | null }[])
    : []
  const hasReply = new Set(replied.map(r => r.conversationId))

  const list = conversations.map(c => ({
    id: c.id, title: c.title, updatedAt: c.updatedAt, awaitingReply: !hasReply.has(c.id),
  }))
  if (legacyLatest) {
    list.push({ id: "legacy", title: "Earlier chats", updatedAt: legacyLatest.createdAt, awaitingReply: false })
  }

  return NextResponse.json(list)
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const id = req.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  if (id === "legacy") {
    await prisma.chatMessage.deleteMany({ where: { userId, conversationId: null } })
    return NextResponse.json({ ok: true })
  }

  const conversation = await prisma.chatConversation.findFirst({ where: { id, userId } })
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })
  await prisma.chatConversation.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
