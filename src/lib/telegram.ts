import { prisma } from "@/lib/prisma"
import { randomBytes } from "crypto"

// Emergy, outside the app.
//
// The ask was Messenger. Telegram instead, and the reason is the part that was
// actually wanted — him reaching out unprompted:
//
//   Messenger needs a Facebook Page, Meta app review for pages_messaging, and
//   business verification. WhatsApp needs verification and a dedicated number,
//   and messages sent outside a 24-hour window must be pre-approved templates
//   that cost money per conversation. Unprompted contact is precisely what
//   both restrict hardest.
//
//   Telegram is a token from BotFather, no review, free, and a bot may message
//   anyone who has started it, whenever it likes.
//
// So this is the only one of the three where "he pops out of the screen"
// works at all, rather than working once a business relationship with Meta
// exists.

const API = "https://api.telegram.org/bot"

export const CHAT_ID_KEY = "telegram_chat_id"
const LINK_CODE_KEY = "telegram_link_code"

/** Codes are short because they get typed on a phone, and die quickly. */
const LINK_CODE_TTL_MS = 15 * 60_000

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN
}

/**
 * Telegram rejects anything over 4096 characters, and Emergy is perfectly
 * capable of exceeding that. Split on paragraph then line boundaries so a
 * message breaks where it reads naturally rather than mid-word.
 */
export function splitMessage(text: string, limit = 4000): string[] {
  if (text.length <= limit) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > limit) {
    const slice = rest.slice(0, limit)
    // Prefer a paragraph break, then a line break, then a space; a hard cut
    // only if the text contains none of them.
    const cut = Math.max(
      slice.lastIndexOf("\n\n"),
      slice.lastIndexOf("\n"),
      slice.lastIndexOf(" "),
    )
    const at = cut > limit * 0.5 ? cut : limit
    out.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest) out.push(rest)
  return out
}

/** Send a message. Returns false rather than throwing — a failed nudge must
 *  never take down the cron that was delivering it. */
export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token || !text.trim()) return false
  try {
    for (const part of splitMessage(text)) {
      const res = await fetch(`${API}${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: part, disable_web_page_preview: true }),
      })
      if (!res.ok) return false
    }
    return true
  } catch {
    return false
  }
}

/** Send to a user by account, if they have linked a chat. */
export async function sendTelegramToUser(userId: string, text: string): Promise<boolean> {
  const chatId = await getChatIdForUser(userId)
  return chatId ? sendTelegramMessage(chatId, text) : false
}

export async function getChatIdForUser(userId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "UserPreference"
    WHERE "userId" = ${userId} AND "key" = ${CHAT_ID_KEY} LIMIT 1
  `.catch(() => [] as { value: string }[])
  return rows[0]?.value || null
}

/** Which account a chat belongs to. Unlinked chats resolve to null and are
 *  answered with an invitation to link, never with anyone's data. */
export async function getUserIdForChat(chatId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "UserPreference"
    WHERE "key" = ${CHAT_ID_KEY} AND "value" = ${chatId} LIMIT 1
  `.catch(() => [] as { userId: string }[])
  return rows[0]?.userId || null
}

export function parseLinkCode(raw: string | null | undefined): { code: string; expiresAt: number } | null {
  if (!raw) return null
  const idx = raw.lastIndexOf(":")
  if (idx <= 0) return null
  const code = raw.slice(0, idx)
  const expiresAt = Number(raw.slice(idx + 1))
  if (!code || !Number.isFinite(expiresAt)) return null
  return { code, expiresAt }
}

export function linkCodeValid(
  stored: { code: string; expiresAt: number } | null,
  given: string,
  now = Date.now(),
): boolean {
  if (!stored) return false
  if (now > stored.expiresAt) return false
  // Compared whole and case-insensitively: the code is typed by hand on a
  // phone keyboard, but a prefix must never be enough.
  return stored.code.toLowerCase() === given.trim().toLowerCase()
}

export async function issueLinkCode(userId: string): Promise<string> {
  // No look-alike characters: this gets read off one screen and typed on
  // another, and 0/O or 1/l would cost more support than they save entropy.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
  const bytes = randomBytes(8)
  const code = Array.from(bytes, b => alphabet[b % alphabet.length]).join("")
  const value = `${code}:${Date.now() + LINK_CODE_TTL_MS}`
  await prisma.$executeRaw`
    INSERT INTO "UserPreference" ("userId", "key", "value")
    VALUES (${userId}, ${LINK_CODE_KEY}, ${value})
    ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${value}
  `
  return code
}

/** Consume a code, binding the chat to whichever account issued it. */
export async function redeemLinkCode(code: string, chatId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ userId: string; value: string }[]>`
    SELECT "userId", "value" FROM "UserPreference" WHERE "key" = ${LINK_CODE_KEY}
  `.catch(() => [] as { userId: string; value: string }[])

  for (const row of rows) {
    if (!linkCodeValid(parseLinkCode(row.value), code)) continue
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${row.userId}, ${CHAT_ID_KEY}, ${chatId})
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${chatId}
    `
    // Single use: a code that stays valid after it has been redeemed is a
    // code someone else can still redeem.
    await prisma.$executeRaw`
      DELETE FROM "UserPreference" WHERE "userId" = ${row.userId} AND "key" = ${LINK_CODE_KEY}
    `
    return row.userId
  }
  return null
}

export async function unlinkTelegram(userId: string): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "UserPreference"
    WHERE "userId" = ${userId} AND "key" IN (${CHAT_ID_KEY}, ${LINK_CODE_KEY})
  `.catch(() => 0)
}
