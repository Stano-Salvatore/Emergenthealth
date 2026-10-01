import { NextRequest, NextResponse } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { configurePush, loadSubscriptionsByUser, sendToUser } from "@/lib/push"
import { sayAsEmergy } from "@/lib/emergy-say"
import { localTimeStr } from "@/lib/local-date"
import { minutesOfDay } from "@/lib/med-schedule"
import { parseCycleSettings } from "@/lib/cycle"
import { CYCLE_SETTINGS_KEY, loadCycle } from "@/lib/cycle-load"
import { headsUpDue, HEADS_UP_PUSH } from "@/lib/cycle-heads-up"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// The opt-in "two days before" push for cycle tracking (lib/cycle-heads-up).
// Once per predicted start, kept in UserPreference so a cron that runs every
// ten minutes says it once. The detail goes to the chat, not the lock screen.

const SENT_KEY = "cycle_heads_up_sent"

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied
  if (!configurePush()) return NextResponse.json({ ok: true, skipped: "push not configured" })

  const rows = await prisma.userPreference.findMany({
    where: { key: CYCLE_SETTINGS_KEY },
    select: { userId: true, value: true },
  }).catch(() => [] as { userId: string; value: string }[])
  const userIds = rows.filter(r => { const s = parseCycleSettings(r.value); return s.enabled && s.headsUp }).map(r => r.userId)
  if (userIds.length === 0) return NextResponse.json({ ok: true, checked: 0, pushed: 0 })

  const subsByUser = await loadSubscriptionsByUser(userIds)
  let pushed = 0
  for (const userId of userIds) {
    const subs = subsByUser.get(userId)
    if (!subs) continue
    try {
      const load = await loadCycle(userId)
      const last = await prisma.userPreference.findUnique({ where: { userId_key: { userId, key: SENT_KEY } }, select: { value: true } }).catch(() => null)
      const due = headsUpDue(load.today, load.settings, last?.value ?? null, minutesOfDay(localTimeStr(load.timezone)))
      if (!due) continue
      // Marked before sending, so a slow push and the next run never double up.
      await prisma.userPreference.upsert({
        where: { userId_key: { userId, key: SENT_KEY } },
        create: { userId, key: SENT_KEY, value: due.key },
        update: { value: due.key },
      })
      const delivered = await sendToUser(subs, { ...HEADS_UP_PUSH, url: "/dashboard/chat", tag: "cycle-heads-up", requireInteraction: false })
      if (delivered) {
        pushed++
        await sayAsEmergy(userId, due.chat, { link: "/dashboard/cycle" }).catch(() => null)
      }
    } catch (e) {
      console.error("[cron/cycle-heads-up] failed for", userId, e instanceof Error ? e.message : e)
    }
  }
  return NextResponse.json({ ok: true, checked: userIds.length, pushed })
}
