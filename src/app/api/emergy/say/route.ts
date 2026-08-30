// Emergy saying something first, in the chat, where it can be replied to.
//
// A chat head pops up, says "💧 Hydration check — how's your water looking",
// and you tap it. What used to happen: a 300dp window opened on an EMPTY chat.
// The one sentence you tapped in order to read was the one thing not on
// screen, and there was nothing to reply to — you had to remember what it
// said and type it back at him.
//
// So the thing he popped up to say becomes a real message in a real
// conversation, and tapping opens that conversation. Reply and he already
// knows what he asked, because it is genuinely the previous turn rather than
// a caption that was thrown away.
//
// The text never travels through a URL. It is read out of the phone's own
// storage by the native bridge and posted here — so a crafted link cannot put
// words in Emergy's mouth, which a `?say=` parameter would have allowed
// anyone who could get this user to open a link to do.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** A notification line, not an essay. Anything longer is not what popped. */
const MAX_LEN = 300

/**
 * Long enough that a nudge tapped an hour later still lands in its own
 * conversation, short enough that two nudges in a morning do not merge into
 * one thread that belongs to neither.
 */
const REUSE_WINDOW_MS = 30 * 60 * 1000

function titleFrom(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim()
  return flat.length > 60 ? flat.slice(0, 60) + "…" : flat || "Emergy"
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null) as { message?: unknown } | null
  const message = typeof body?.message === "string"
    ? body.message.replace(/\s+/g, " ").trim().slice(0, MAX_LEN)
    : ""
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 })

  // The same pop opened twice — tapped, backgrounded, tapped again — is one
  // conversation, not two identical ones a minute apart.
  const recent = await prisma.chatMessage.findFirst({
    where: {
      userId,
      role: "assistant",
      content: message,
      createdAt: { gte: new Date(Date.now() - REUSE_WINDOW_MS) },
      conversationId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { conversationId: true },
  }).catch(() => null)
  if (recent?.conversationId) {
    return NextResponse.json({ conversationId: recent.conversationId, reused: true })
  }

  const conversation = await prisma.chatConversation.create({
    data: { userId, title: titleFrom(message) },
  })
  await prisma.chatMessage.create({
    data: { userId, conversationId: conversation.id, role: "assistant", content: message },
  })

  return NextResponse.json({ conversationId: conversation.id, reused: false })
}
