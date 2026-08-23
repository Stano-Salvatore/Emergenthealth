import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getChatIdForUser, issueLinkCode, telegramConfigured, unlinkTelegram } from "@/lib/telegram"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Whether this account has a chat linked, and whether the server can do this
 *  at all — an unconfigured server says so rather than offering a dead button. */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json({
    configured: telegramConfigured(),
    linked: (await getChatIdForUser(session.user.id)) != null,
    botUsername: process.env.TELEGRAM_BOT_USERNAME ?? null,
  })
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!telegramConfigured()) {
    return NextResponse.json({ error: "Telegram isn't set up on this server yet." }, { status: 503 })
  }
  return NextResponse.json({ code: await issueLinkCode(session.user.id), expiresInMinutes: 15 })
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await unlinkTelegram(session.user.id)
  return NextResponse.json({ ok: true })
}
