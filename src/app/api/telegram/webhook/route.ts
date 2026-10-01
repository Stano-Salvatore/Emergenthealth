import { NextRequest, NextResponse, after } from "next/server"
import { headerSecretMatches } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { streamChatResponse } from "@/lib/claude"
import { claimEmergyTurn, quotaReply } from "@/lib/emergy-quota"
import { checkRateLimit } from "@/lib/rate-limit"
import {
  getUserIdForChat, redeemLinkCode, sendTelegramMessage, telegramConfigured,
} from "@/lib/telegram"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Emergy's replies are Opus calls with tool turns, run in after() — which
// gets this same budget.
export const maxDuration = 300

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
//
// The same retry is why Emergy's turn runs after the 200 has gone. Run
// before it, a turn that outlived the function was killed with a 504, and
// Telegram redelivered the message: its write tools ran again, logging the
// same beers twice, and again on every retry.

const MAX_INCOMING_CHARS = 4000

// How long a claimed update_id is remembered. Telegram stops redelivering an
// update after 24 hours; the margin covers a clock or retry-schedule surprise.
const UPDATE_MEMORY_MS = 2 * 86_400_000

/**
 * Take this update for processing, once. False when it has already been
 * taken — a redelivery.
 *
 * Each update_id is claimed on its own, not as "the highest seen": Telegram
 * delivers over several connections at once, so a burst (three forwarded
 * messages) can land out of order, and a high-water mark would drop the
 * earlier ones as redeliveries without a word. A failed claim lets the
 * message through: a rare duplicate beats a message silently dropped.
 */
async function claimUpdate(userId: string, updateId: unknown): Promise<boolean> {
  if (typeof updateId !== "number" || !Number.isSafeInteger(updateId)) return true
  const now = Date.now()
  const claimed = await prisma.$executeRaw`
    INSERT INTO "UserPreference" ("userId", "key", "value")
    VALUES (${userId}, ${`telegram_update:${updateId}`}, ${String(now)})
    ON CONFLICT ("userId", "key") DO NOTHING
  `.catch(() => 1)
  // Claims older than any redelivery are only clutter.
  await prisma.$executeRaw`
    DELETE FROM "UserPreference"
    WHERE "userId" = ${userId} AND "key" LIKE 'telegram_update:%'
      AND CASE WHEN "value" ~ '^[0-9]{1,15}$' THEN "value"::bigint < ${String(now - UPDATE_MEMORY_MS)}::bigint ELSE true END
  `.catch(() => 0)
  return claimed > 0
}

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
    update_id?: number
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

  if (!(await claimUpdate(userId, update?.update_id))) return NextResponse.json({ ok: true })

  // Every message here reaches the model, so each one spends the same daily
  // allowance as the app's chat (lib/emergy-quota). Claimed after the
  // duplicate check, so a webhook Telegram redelivers is not counted twice.
  if (!(await claimEmergyTurn(userId)).allowed) {
    await sendTelegramMessage(chat, quotaReply("telegram"))
    return NextResponse.json({ ok: true })
  }

  after(async () => {
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
        select: { role: true, content: true, createdAt: true },
      }).catch(() => [] as { role: string; content: string; createdAt: Date }[])
      const history = priorRows
        .reverse()
        .map(m => ({ role: m.role === "assistant" ? "assistant" as const : "user" as const, content: m.content, at: m.createdAt }))

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
    } catch (error) {
      console.error("[telegram] turn failed", error instanceof Error ? error.message : error)
      await sendTelegramMessage(chat, "Something went wrong on my side — try again in a moment 🌱")
    }
  })

  return NextResponse.json({ ok: true })
}
