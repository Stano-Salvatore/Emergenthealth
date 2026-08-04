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

  const list = conversations.map(c => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }))
  if (legacyLatest) {
    list.push({ id: "legacy", title: "Earlier chats", updatedAt: legacyLatest.createdAt })
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
