// Answering the lookup questions from the app's own numbers.
//
// `quick-answer.ts` says which question was asked; this file reads the data and
// writes the sentence. Every figure here comes from the same helpers the rest
// of the app uses — `hydrationMl`, `activeFromDoses`, `alcoholRemainingG`,
// `getGoals` — so a scripted answer and Emergy's answer can never disagree
// about a number.
//
// Two rules run through all of it:
//
//   Say what is missing. "No sleep data for three of those nights" is a better
//   answer than an average quietly taken over four. The app's standing
//   convention is honest status text over reassuring status text, and a
//   scripted sentence is the easiest place in the codebase to break it.
//
//   Never conclude. These answers report; they do not say whether a number is
//   good, why it moved, or what to do about it. That is Emergy's, and the
//   moment a script starts editorialising it is pretending to a judgement it
//   did not make.

import { prisma } from "@/lib/prisma"
import { getUserTimezone } from "@/lib/user-timezone"
import { localDateStr, zonedDayRange, addDaysISO } from "@/lib/local-date"
import { hydrationMl } from "@/lib/hydration"
import { activeFromDoses } from "@/lib/caffeine"
import { alcoholRemainingG, alcoholClearanceGPerHour, ethanolGrams } from "@/lib/body-load"
import { getGoals } from "@/lib/goals"
import { formatDose } from "@/lib/dose"
import { parseQuickAsk, type QuickAsk } from "@/lib/quick-answer"
import { chipsFromClaim, type SourceChip, type SourceManifest } from "@/lib/chat-sources"

export interface QuickAnswer {
  /** The reply, in Emergy's voice, with a chart tag on its own line where one earns its place. */
  reply: string
  /** The receipts, built by the same function that builds the model's — one label, one hue, one place. */
  sources: SourceChip[]
}

/**
 * Chips for what this answer actually read. Emergy's chips are a claim the app
 * checks against what it gave him; here the read IS the manifest, so the same
 * object plays both parts and the two can never render differently.
 */
function chips(manifest: SourceManifest): SourceChip[] {
  return chipsFromClaim(Object.keys(manifest), manifest)
}

const ml = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}L` : `${n}ml`)

/** "7h 12m" — the way a night is spoken, never 432 minutes. */
function hm(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h > 0 ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`
}

function pretty(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)))
}

function list(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ""
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}

// ── The answers ────────────────────────────────────────────────────────────

async function loggedToday(userId: string, tz: string): Promise<QuickAnswer> {
  const today = localDateStr(tz)
  const { start, end } = zonedDayRange(tz, today)
  const [drinks, doses] = await Promise.all([
    prisma.intakeLog.findMany({
      where: { userId, loggedAt: { gte: start, lte: end } },
      orderBy: { loggedAt: "asc" },
      select: { type: true, amountMl: true, note: true },
    }).catch(() => []),
    todaysDoses(userId, today),
  ])

  if (drinks.length === 0 && doses.length === 0) {
    return { reply: "Nothing logged today yet.", sources: [] }
  }

  const byType = new Map<string, { ml: number; notes: Set<string> }>()
  for (const d of drinks) {
    const entry = byType.get(d.type) ?? { ml: 0, notes: new Set<string>() }
    entry.ml += d.amountMl
    // "Cold brew @ Kaviareň Vták" is one drink named twice over a day; the
    // place is where it happened, not what it was.
    if (d.note) entry.notes.add(d.note.split(" @ ")[0])
    byType.set(d.type, entry)
  }

  const lines: string[] = []
  for (const [type, entry] of byType) {
    const names = [...entry.notes].filter(n => n.toLowerCase() !== type)
    lines.push(`- **${ml(entry.ml)}** ${type}${names.length ? ` (${names.join(", ")})` : ""}`)
  }
  if (doses.length > 0) lines.push(`- **${doses.length}** ${doses.length === 1 ? "dose" : "doses"}: ${list(doses.map(d => d.label))}`)

  // Hydration, not volume: a beer is mostly water and spirits count for none
  // of it, which is what hydrationMl encodes.
  const fluid = drinks.reduce((sum, d) => sum + hydrationMl(d.type, d.amountMl), 0)
  const fluidLine = `\n\n${ml(fluid)} of fluid so far today.`

  return {
    reply: `Today so far:\n\n${lines.join("\n")}${fluid > 0 ? fluidLine : ""}`,
    sources: chips({ intake: "today", ...(doses.length ? { meds: "today" } : {}) }),
  }
}

async function intakeTotal(userId: string, tz: string, type: string, label: string): Promise<QuickAnswer> {
  const { start, end } = zonedDayRange(tz, localDateStr(tz))
  // "Alcohol" is a question about beer, wine and spirits together, not about
  // the one intake type that happens to be spelled that way.
  const types = type === "alcohol" ? ["beer", "wine", "spirits", "alcohol"] : [type]
  const rows = await prisma.intakeLog.findMany({
    where: { userId, type: { in: types }, loggedAt: { gte: start, lte: end } },
    orderBy: { loggedAt: "asc" },
    select: { amountMl: true, note: true, type: true },
  }).catch(() => [])

  if (rows.length === 0) return { reply: `No ${label} logged today.`, sources: [] }

  const total = rows.reduce((s, r) => s + r.amountMl, 0)
  const each = rows.length > 1 ? ` across ${rows.length} drinks` : ""
  const names = [...new Set(rows.map(r => r.note?.split(" @ ")[0]).filter(Boolean) as string[])]
  const detail = names.length && names.join().toLowerCase() !== label ? ` — ${list(names)}` : ""
  return {
    reply: `**${ml(total)}** of ${label} today${each}${detail}.`,
    sources: chips({ intake: "today" }),
  }
}

async function todaysDoses(userId: string, today: string) {
  const rows = await prisma.ouraTag.findMany({
    where: { userId, day: today, tagName: { not: null } },
    orderBy: { timestamp: "asc" },
    select: { tagName: true, doseAmount: true, doseUnit: true },
  }).catch(() => [])
  return rows.map(r => {
    const amount = formatDose(r.doseAmount, r.doseUnit)
    return { label: `${r.tagName}${amount ? ` ${amount}` : ""}` }
  })
}

async function dosesToday(userId: string, tz: string): Promise<QuickAnswer> {
  const doses = await todaysDoses(userId, localDateStr(tz))
  if (doses.length === 0) return { reply: "Nothing logged today.", sources: [] }
  return {
    reply: `Today: ${list(doses.map(d => d.label))}.`,
    sources: chips({ meds: "today" }),
  }
}

async function bodyNow(userId: string, tz: string): Promise<QuickAnswer> {
  const now = new Date()
  // Yesterday too: a 23:00 beer is still being cleared at 02:00, and caffeine
  // from late afternoon is still measurable at midnight.
  const since = new Date(now.getTime() - 36 * 3_600_000)
  const [caffeine, drinks, goals] = await Promise.all([
    prisma.caffeineLog.findMany({
      where: { userId, loggedAt: { gte: since } },
      select: { caffeineMg: true, loggedAt: true },
    }).catch(() => []),
    prisma.intakeLog.findMany({
      where: { userId, type: { in: ["beer", "wine", "spirits", "alcohol"] }, loggedAt: { gte: since } },
      select: { type: true, amountMl: true, note: true, loggedAt: true },
    }).catch(() => []),
    getGoals(userId),
  ])

  const activeMg = activeFromDoses(caffeine, now.getTime())
  const alcohol = alcoholRemainingG(
    drinks.map(d => ({ grams: ethanolGrams(d.type, d.amountMl, d.note ?? undefined), at: d.loggedAt })),
    now,
    alcoholClearanceGPerHour(goals.weightKg, goals.sex),
  )

  const parts: string[] = []
  if (activeMg > 0) parts.push(`**${activeMg}mg** of caffeine still circulating`)
  if (alcohol.remainingG > 0.5) {
    const clears = alcohol.clearsAt
      ? `, clear around ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(alcohol.clearsAt)}`
      : ""
    parts.push(`**${Math.round(alcohol.remainingG)}g** of alcohol left to clear${clears}`)
  }
  if (parts.length === 0) return { reply: "Nothing much — no caffeine or alcohol still circulating.", sources: [] }
  return {
    reply: `${list(parts)}.`,
    sources: chips({ intake: "36h" }),
  }
}

async function sleep(userId: string, tz: string, window: "night" | "week", debt: boolean): Promise<QuickAnswer> {
  const today = localDateStr(tz)
  const days = window === "week" ? 7 : 1
  const from = addDaysISO(today, -(days - 1))
  const rows = await prisma.healthLog.findMany({
    where: { userId, date: { gte: new Date(from + "T00:00:00Z"), lte: new Date(today + "T00:00:00Z") } },
    orderBy: { date: "asc" },
    select: { date: true, sleepDuration: true, sleepScore: true, deepSleep: true, remSleep: true },
  }).catch(() => [])

  const nights = rows.filter(r => r.sleepDuration != null && r.sleepDuration > 0)
  if (nights.length === 0) {
    return { reply: window === "week" ? "No sleep data for the last seven nights." : "No sleep data for last night.", sources: [] }
  }

  const goals = await getGoals(userId)
  const goalMin = Math.round(goals.sleepH * 60)

  if (window === "night") {
    const n = nights[nights.length - 1]
    const score = n.sleepScore != null ? `, score **${n.sleepScore}**` : ""
    const stages = n.deepSleep != null && n.remSleep != null
      ? ` (${hm(n.deepSleep)} deep, ${hm(n.remSleep)} REM)`
      : ""
    return {
      reply: `Last night: **${hm(n.sleepDuration!)}** asleep${score}${stages}.`,
      sources: chips({ sleep: "1 night" }),
    }
  }

  const totalMin = nights.reduce((s, n) => s + (n.sleepDuration ?? 0), 0)
  const avgMin = totalMin / nights.length
  const scored = nights.filter(n => n.sleepScore != null)
  const avgScore = scored.length ? Math.round(scored.reduce((s, n) => s + (n.sleepScore ?? 0), 0) / scored.length) : null

  // What is missing is part of the answer, not a footnote to leave off — and
  // "last 5 nights" would quietly redefine the week the user asked about.
  const missing = days - nights.length
  const gap = missing > 0
    ? ` ${missing === 1 ? "One night" : `${missing} nights`} of the seven ${missing === 1 ? "has" : "have"} no data.`
    : ""
  const over = missing > 0 ? ` across the ${nights.length} with data` : ""

  if (debt) {
    const shortfall = goalMin * nights.length - totalMin
    const nightWord = nights.length === 1 ? "night" : "nights"
    const line = shortfall > 0
      ? `Across ${nights.length} ${nightWord} you slept **${hm(shortfall)}** less than your ${goals.sleepH}h goal.`
      : `You are **${hm(-shortfall)}** ahead of your ${goals.sleepH}h goal across ${nights.length} ${nightWord}.`
    return {
      reply: `${line}${gap}\n\n[chart:sleep-week]`,
      sources: chips({ sleep: `${nights.length} nights` }),
    }
  }

  const best = nights.reduce((a, b) => ((b.sleepDuration ?? 0) > (a.sleepDuration ?? 0) ? b : a))
  const worst = nights.reduce((a, b) => ((b.sleepDuration ?? 0) < (a.sleepDuration ?? 0) ? b : a))
  const dayOf = (d: Date) => pretty(d.toISOString().slice(0, 10))

  const scoreLine = avgScore != null ? `, score **${avgScore}**` : ""
  const spread = nights.length > 1
    ? ` Longest ${hm(best.sleepDuration!)} on ${dayOf(best.date)}, shortest ${hm(worst.sleepDuration!)} on ${dayOf(worst.date)}.`
    : ""

  return {
    reply: `Last seven nights: **${hm(avgMin)}** a night on average${over}${scoreLine}.${gap}${spread}\n\n[chart:sleep-week]`,
    sources: chips({ sleep: `${nights.length} nights` }),
  }
}

/**
 * Answer a lookup question from the database, or return null to let Emergy
 * have it. Null is the answer for anything `parseQuickAsk` is not certain of.
 */
export async function runQuickAnswer(userId: string, message: string): Promise<QuickAnswer | null> {
  const ask: QuickAsk | null = parseQuickAsk(message)
  if (!ask) return null
  const tz = await getUserTimezone(userId)

  switch (ask.kind) {
    case "logged_today": return loggedToday(userId, tz)
    case "intake_total": return intakeTotal(userId, tz, ask.type, ask.label)
    case "doses_today": return dosesToday(userId, tz)
    case "body_now": return bodyNow(userId, tz)
    case "sleep": return sleep(userId, tz, ask.window, ask.debt === true)
  }
}
