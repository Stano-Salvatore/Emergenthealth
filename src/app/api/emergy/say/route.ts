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
// a caption that was thrown away. The proactive crons post through the same
// helper (lib/emergy-say), so a pushed pattern update is a message too.
//
// The text never travels through a URL. It is read out of the phone's own
// storage by the native bridge and posted here — so a crafted link cannot put
// words in Emergy's mouth, which a `?say=` parameter would have allowed
// anyone who could get this user to open a link to do.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { sayAsEmergy } from "@/lib/emergy-say"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => null) as { message?: unknown } | null
  const message = typeof body?.message === "string" ? body.message : ""
  const result = await sayAsEmergy(session.user.id, message)
  if (!result) return NextResponse.json({ error: "message is required" }, { status: 400 })
  return NextResponse.json(result)
}
