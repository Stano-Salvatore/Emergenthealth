// The opt-in push before a period: once per predicted start, in the
// daytime. The notification itself says only "Cycle heads-up" — a lock
// screen is seen by others — and the detail lands in the chat, inside the app.

import type { CycleSettings, CycleToday } from "@/lib/cycle"
import { shortDay } from "@/lib/cycle-text"

export const HEADS_UP_PUSH = {
  title: "🌸 Cycle heads-up",
  body: "Something to plan for in the next couple of days — tap to see.",
} as const

const FROM_MIN = 8 * 60
const UNTIL_MIN = 21 * 60

export function headsUpDue(
  t: CycleToday, settings: CycleSettings, lastKey: string | null, localMinutes: number,
): { key: string; chat: string } | null {
  if (!settings.enabled || !settings.headsUp) return null
  if (localMinutes < FROM_MIN || localMinutes >= UNTIL_MIN) return null

  if (t.mode === "pack") {
    const p = t.pack
    if (!p?.active || p.breakStartsIn == null || p.breakStartsIn < 1 || p.breakStartsIn > 2 || !p.nextBreak) return null
    const key = `break:${p.nextBreak}`
    if (key === lastKey) return null
    return { key, chat: `Your break week starts in ${p.breakStartsIn === 1 ? "1 day" : "2 days"}, on ${shortDay(p.nextBreak)}. A withdrawal bleed usually begins two to four days into it.` }
  }

  if (t.periodOngoing || t.lateBy > 0 || !t.nextStart || t.daysUntilNext == null) return null
  if (t.daysUntilNext < 1 || t.daysUntilNext > 2) return null
  const key = `period:${t.nextStart}`
  if (key === lastKey) return null
  const when = t.daysUntilNext === 1 ? "tomorrow" : "in 2 days"
  const window = t.nextWindow ? ` (most likely ${shortDay(t.nextWindow[0])} – ${shortDay(t.nextWindow[1])})` : ""
  return { key, chat: `Your period is likely ${when}${window}. Worth having pads, tampons or a cup with you.` }
}
