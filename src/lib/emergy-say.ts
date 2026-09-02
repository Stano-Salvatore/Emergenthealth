import { prisma } from "@/lib/prisma"

// Emergy saying something first — as a real message in a real conversation,
// so the user can reply to it and he knows what he said.
//
// The proactive crons (anomaly watch, pattern updates, the wind-down nudge,
// the weekly review) used to push a notification and forget it: Emergy had no
// idea he had sent it, and tapping it opened an empty chat. Now the same text
// lands as the opening turn of a conversation, and the last few of them are
// listed in his prompt as "what you told them recently".

/** A notification line, not an essay. Anything longer is not what popped. */
export const SAY_MAX_LEN = 300

/**
 * Long enough that a nudge tapped an hour later still lands in its own
 * conversation, short enough that two nudges in a morning do not merge into
 * one thread that belongs to neither.
 */
const REUSE_WINDOW_MS = 30 * 60 * 1000

/** UserPreference key holding the last few proactive messages, newest first. */
export const SAID_KEY = "emergy:said"
const SAID_KEEP = 8

export interface SaidEntry { at: string; text: string }

function titleFrom(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim()
  return flat.length > 60 ? flat.slice(0, 60) + "…" : flat || "Emergy"
}

export function parseSaid(value: string | null | undefined): SaidEntry[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e): e is SaidEntry => typeof e?.at === "string" && typeof e?.text === "string")
  } catch {
    return []
  }
}

export async function sayAsEmergy(
  userId: string,
  raw: string,
): Promise<{ conversationId: string; reused: boolean } | null> {
  const message = raw.replace(/\s+/g, " ").trim().slice(0, SAY_MAX_LEN)
  if (!message) return null

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
  if (recent?.conversationId) return { conversationId: recent.conversationId, reused: true }

  const conversation = await prisma.chatConversation.create({
    data: { userId, title: titleFrom(message) },
  })
  await prisma.chatMessage.create({
    data: { userId, conversationId: conversation.id, role: "assistant", content: message },
  })

  // Remembered for the prompt, so "you said my HRV was low" makes sense to him.
  const existing = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: SAID_KEY } },
    select: { value: true },
  }).catch(() => null)
  const said: SaidEntry[] = [{ at: new Date().toISOString(), text: message }, ...parseSaid(existing?.value)].slice(0, SAID_KEEP)
  const value = JSON.stringify(said)
  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: SAID_KEY } },
    create: { userId, key: SAID_KEY, value },
    update: { value },
  }).catch(() => null)

  return { conversationId: conversation.id, reused: false }
}
