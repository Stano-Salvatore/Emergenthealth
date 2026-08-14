// Per-user, per-day record of which notifications have already gone out.
//
// Every delivery job here is driven by a scheduler that may tick many times
// inside the window a notification is due (the Actions cron runs every ten
// minutes), so "is it time?" alone would deliver the same nudge on every
// pass. Each job keeps one UserPreference row of {date, ids} and skips ids
// already recorded for the user's current local date; the date rolling over
// resets the log implicitly.
//
// Deliveries are recorded even when the send fails: a dead subscription would
// otherwise be retried on every tick for the rest of the day.

import { prisma } from "@/lib/prisma"

interface SentLog { date: string; ids: string[] }

export async function readSentLog(userId: string, key: string, localDate: string): Promise<Set<string>> {
  const row = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key } },
    select: { value: true },
  }).catch(() => null)
  try {
    const parsed = JSON.parse(row?.value ?? "{}") as SentLog
    if (parsed.date === localDate && Array.isArray(parsed.ids)) return new Set(parsed.ids)
  } catch { /* corrupt or first run — start clean */ }
  return new Set()
}

export async function writeSentLog(userId: string, key: string, localDate: string, ids: Set<string>): Promise<void> {
  const value = JSON.stringify({ date: localDate, ids: [...ids] } satisfies SentLog)
  await prisma.userPreference.upsert({
    where:  { userId_key: { userId, key } },
    create: { userId, key, value },
    update: { value },
  }).catch(() => {})
}
