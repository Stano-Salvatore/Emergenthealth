import { NextRequest, NextResponse } from "next/server"
import { headerSecretMatches } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { streamChatResponse } from "@/lib/claude"
import { checkRateLimit } from "@/lib/rate-limit"
import {
  getUserIdForChat, redeemLinkCode, sendTelegramMessage, telegramConfigured,
} from "@/lib/telegram"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60 // Emergy's replies are Opus calls

// Telegram posts every message here, and this URL is public — anyone who
// guesses it can POST, and anyone who finds the bot can message it. Three
// things follow, and all three are the difference between a companion and a
// data leak:
//
//   1. Telegram signs its calls with the secret given at setWebhook time.
//      Without a match, nothing is read.
//   2. A chat that is not linked to an account gets an invitation to link and
//      nothing else — never a fact about anyone.
//   3. Every reply always returns 200. Telegram retries non-2xx, so an error
//      surfaced as a status code becomes the same failing message delivered
//      over and over.

const MAX_INCOMING_CHARS = 4000

/**
 * Telegram's own thread, kept apart from the web conversations because they
 * are different conversations and interleaving them would confuse both.
 *
 * A real ChatConversation row, not a magic string: conversationId is a foreign
 * key, so a literal would have passed the type checker and then failed on the
 * first message anyone sent.
 */
async function telegramConversationId(userId: string): Promise<string | null> {
  const id = `tg_${userId}`
  const created = await prisma.chatConversation.upsert({
    where: { id },
    create: { id, userId, title: "Telegram" },
    update: {},
    select: { id: true },
  }).catch(() => null)
  return created?.id ?? null
}

export async function POST(req: NextRequest) {
  if (!telegramConfigured()) return NextResponse.json({ ok: true })

  // Unconfigured means closed: without the secret, anyone who guesses a
  // linked chat id (a small integer) could drive Emergy's write tools as that
  // user. Say nothing about why either way.
  if (!headerSecretMatches(req.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: true })
  }

  const update = await req.json().catch(() => null) as {
    message?: { chat?: { id?: number }; text?: string }
  } | null

  const chatId = update?.message?.chat?.id
  const text = (update?.message?.text ?? "").trim()
  if (!chatId || !text) return NextResponse.json({ ok: true })
  const chat = String(chatId)

  // ── Linking ──────────────────────────────────────────────────────────────
  if (text.startsWith("/start")) {
    const code = text.slice("/start".length).trim()
    if (!code) {
      await sendTelegramMessage(chat,
        "Hi — I'm Emergy 🌱\n\nTo connect me to your account, open Emergenthealth → Settings → Telegram, and send me the code it shows you.")
      return NextResponse.json({ ok: true })
    }
    const linked = await redeemLinkCode(code, chat)
    await sendTelegramMessage(chat, linked
      ? "Connected 🌱 I can see your sleep, habits, meds and calendar now. Talk to me like you do in the app — you can log things here too."
      : "That code didn't work. They expire after 15 minutes, so grab a fresh one from Settings → Telegram.")
    return NextResponse.json({ ok: true })
  }

  const userId = await getUserIdForChat(chat)
  if (!userId) {
    await sendTelegramMessage(chat,
      "I don't know whose account this chat belongs to yet. Open Emergenthealth → Settings → Telegram and send me the code it gives you.")
    return NextResponse.json({ ok: true })
  }

  if (text === "/unlink") {
    await prisma.$executeRaw`
      DELETE FROM "UserPreference" WHERE "userId" = ${userId} AND "key" = 'telegram_chat_id'
    `.catch(() => 0)
    await sendTelegramMessage(chat, "Disconnected. I won't message you here any more 🌱")
    return NextResponse.json({ ok: true })
  }

  // Opus calls cost real money and this endpoint is reachable by anyone who
  // has linked; a runaway loop should stop rather than bill.
  const rl = checkRateLimit(userId, "telegram_chat", 60, 60 * 60_000)
  if (!rl.allowed) {
    await sendTelegramMessage(chat, "That's a lot of messages in one hour — give me a little while 🌱")
    return NextResponse.json({ ok: true })
  }

  const incoming = text.slice(0, MAX_INCOMING_CHARS)

  try {
    // Telegram keeps its own thread. Without it every message would arrive
    // with no memory of the last one, so "make that 300 instead" would mean
    // nothing — and a companion that forgets the previous sentence is not one.
    //
    // Kept separate from the web conversations rather than mixed in: they are
    // different conversations, and interleaving them would confuse both.
    const conversationId = await telegramConversationId(userId)
    const priorRows = await prisma.chatMessage.findMany({
      where: { userId, conversationId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { role: true, content: true },
    }).catch(() => [] as { role: string; content: string }[])
    const history = priorRows
      .reverse()
      .map(m => ({ role: m.role === "assistant" ? "assistant" as const : "user" as const, content: m.content }))

    let reply = ""
    for await (const chunk of streamChatResponse(userId, incoming, history)) {
      reply += chunk
    }
    reply = reply.trim() || "…I didn't manage a reply to that. Try again?"

    await sendTelegramMessage(chat, reply)

    // Stored after sending: a reply the user never received should not be in
    // the history as though they had read it.
    if (conversationId) {
      await prisma.chatMessage.createMany({
        data: [
          { userId, conversationId, role: "user", content: incoming },
          { userId, conversationId, role: "assistant", content: reply },
        ],
      }).catch(() => null)
    }
  } catch {
    await sendTelegramMessage(chat, "Something went wrong on my side — try again in a moment 🌱")
  }

  return NextResponse.json({ ok: true })
}
