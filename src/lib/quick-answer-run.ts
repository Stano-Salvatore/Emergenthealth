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
import { ALCOHOL_TYPES, alcoholRemainingG, alcoholClearanceGPerHour, ethanolGrams } from "@/lib/body-load"
import { getGoals } from "@/lib/goals"
import { formatDose } from "@/lib/dose"
import { parseQuickAsk, type QuickAsk } from "@/lib/quick-answer"
import { chipsFromClaim, type SourceChip, type SourceManifest } from "@/lib/chat-sources"
import { bedtimeMinutesLate } from "@/lib/caffeine-cutoff"
import { whyNightMissing } from "@/lib/sleep-quality"
import { isDueOn, normalizeSchedule, weekStart } from "@/lib/habit-schedule"
import { getTodayEvents } from "@/lib/google-calendar"
import { loadEventOccurrences } from "@/lib/app-events"
import { mergeDayEvents } from "@/lib/day-events"

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

/**
 * Below this, "still circulating" is arithmetic rather than a fact about the
 * body: 1mg is a hundredth of an espresso. Shared by both answers that say it,
 * so the two can never put different words on the same afternoon.
 */
const CAFFEINE_FLOOR_MG = 5

/** "7h 12m" — the way a night is spoken, never 432 minutes. */
function hm(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h > 0 ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`
}

/** Small counts read as words inside a sentence; past ten, the digit is clearer. */
function count(n: number): string {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n)
}

function pretty(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)))
}

/** Minutes-past-midnight (late-shifted) back to a clock a person reads. */
function clock(mins: number): string {
  const v = ((Math.round(mins) % 1440) + 1440) % 1440
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`
}

/** A word that has to start a sentence. `count` writes for mid-sentence. */
function sentence(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
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
  const types: string[] = type === "alcohol" ? [...ALCOHOL_TYPES] : [type]
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
      where: { userId, type: { in: [...ALCOHOL_TYPES] }, loggedAt: { gte: since } },
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
  if (activeMg >= CAFFEINE_FLOOR_MG) parts.push(`**${activeMg}mg** of caffeine still circulating`)
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
    select: {
      date: true, sleepDuration: true, sleepScore: true, deepSleep: true, remSleep: true,
      sleepLatency: true, sleepEfficiency: true, sleepStart: true, steps: true,
    },
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
    const extra: string[] = []
    if (n.sleepLatency != null) extra.push(`Took **${n.sleepLatency} min** to fall asleep`)
    if (n.sleepEfficiency != null) extra.push(`efficiency **${n.sleepEfficiency}%**`)
    return {
      reply: `Last night: **${hm(n.sleepDuration!)}** asleep${score}${stages}.${extra.length ? ` ${extra.join(", ")}.` : ""}`,
      sources: chips({ sleep: "1 night" }),
    }
  }

  const totalMin = nights.reduce((s, n) => s + (n.sleepDuration ?? 0), 0)
  const avgMin = totalMin / nights.length
  const scored = nights.filter(n => n.sleepScore != null)
  const avgScore = scored.length ? Math.round(scored.reduce((s, n) => s + (n.sleepScore ?? 0), 0) / scored.length) : null

  // What is missing is part of the answer, not a footnote to leave off — and
  // "last 5 nights" would quietly redefine the week the user asked about.
  //
  // Tonight is not missing, though, it just has not happened. A night is filed
  // under the day you wake, so at 03:00 today's row does not exist yet and
  // counting it as a gap invents one. A false gap is worse than no gap: it
  // trains you to ignore the real ones.
  const pending = rows.every(r => r.date.toISOString().slice(0, 10) !== today) ? 1 : 0
  const missing = Math.max(0, days - nights.length - pending)

  // "No data" is two different weeks wearing the same word. A night the ring
  // sat in a drawer is a hole in the record; a night the ring was on your hand
  // all day and still filed nothing is a fact about the night. The day's step
  // count tells them apart — see whyNightMissing — and the second one is
  // usually the answer to "why does this week look so short".
  const blank = rows.filter(r =>
    !(r.sleepDuration != null && r.sleepDuration > 0) &&
    r.date.toISOString().slice(0, 10) !== today)
  const ringOff = blank.filter(r => whyNightMissing(r.steps) === "ring-off").length
  const awake = blank.filter(r => whyNightMissing(r.steps) === "awake").length

  const named = [
    ringOff > 0 ? { n: ringOff, text: "the ring looks like it was off" } : null,
    awake > 0 ? { n: awake, text: "the ring was on all day and still recorded no sleep" } : null,
  ].filter((r): r is { n: number; text: string } => r != null)
  const why = named.length === 0
    ? ""
    : named.length === 1 && named[0].n === missing
      ? ` — ${named[0].text}`
      : ` — ${named.map(r => `${count(r.n)} where ${r.text}`).join(", ")}`

  const gap = missing > 0
    ? ` ${missing === 1 ? "One night" : `${missing} nights`} of the seven ${missing === 1 ? "has" : "have"} no data${why}.`
    : ""
  const notYet = pending ? " Last night isn't in yet." : ""
  const over = missing + pending > 0 ? ` across the ${nights.length} with data` : ""

  if (debt) {
    const shortfall = goalMin * nights.length - totalMin
    const nightWord = nights.length === 1 ? "night" : "nights"
    const line = shortfall > 0
      ? `Across ${nights.length} ${nightWord} you slept **${hm(shortfall)}** less than your ${goals.sleepH}h goal.`
      : `You are **${hm(-shortfall)}** ahead of your ${goals.sleepH}h goal across ${nights.length} ${nightWord}.`
    return {
      reply: `${line}${gap}${notYet}\n\n[chart:sleep-week]`,
      sources: chips({ sleep: `${nights.length} nights` }),
    }
  }

  // The three that vary most week to week and say something the average
  // cannot: latency swings 6 to 56 minutes in a normal week here, and a
  // bedtime spread of five hours is the story of that week.
  const lats = nights.map(n => n.sleepLatency).filter((v): v is number => v != null).sort((a, b) => a - b)
  const effs = nights.map(n => n.sleepEfficiency).filter((v): v is number => v != null)
  const beds = nights.map(n => n.sleepStart).filter((v): v is Date => v != null)
    .map(d => bedtimeMinutesLate(d, tz)).sort((a, b) => a - b)

  const detail: string[] = []
  if (lats.length >= 3) {
    const med = lats[Math.floor(lats.length / 2)]
    const spread = lats[lats.length - 1] - lats[0]
    detail.push(spread >= 15
      ? `Took **${med} min** to fall asleep on a typical night, anywhere from ${lats[0]} to ${lats[lats.length - 1]}`
      : `Took **${med} min** to fall asleep on a typical night`)
  }
  if (effs.length >= 3) detail.push(`efficiency **${Math.round(effs.reduce((a, b) => a + b, 0) / effs.length)}%**`)
  if (beds.length >= 3) {
    detail.push(`bed between **${clock(beds[0])}** and **${clock(beds[beds.length - 1])}**`)
  }

  const best = nights.reduce((a, b) => ((b.sleepDuration ?? 0) > (a.sleepDuration ?? 0) ? b : a))
  const worst = nights.reduce((a, b) => ((b.sleepDuration ?? 0) < (a.sleepDuration ?? 0) ? b : a))
  const dayOf = (d: Date) => pretty(d.toISOString().slice(0, 10))

  const scoreLine = avgScore != null ? `, score **${avgScore}**` : ""
  const spread = nights.length > 1
    ? ` Longest ${hm(best.sleepDuration!)} on ${dayOf(best.date)}, shortest ${hm(worst.sleepDuration!)} on ${dayOf(worst.date)}.`
    : ""

  return {
    reply: `Last seven nights: **${hm(avgMin)}** a night on average${over}${scoreLine}.${gap}${notYet}${spread}${detail.length ? `\n\n${detail[0].charAt(0).toUpperCase()}${detail[0].slice(1)}${detail.length > 1 ? `, ${detail.slice(1).join(", ")}` : ""}.` : ""}\n\n[chart:sleep-week]`,
    sources: chips({ sleep: `${nights.length} nights` }),
  }
}

/**
 * Answer a lookup question from the database, or return null to let Emergy
 * have it. Null is the answer for anything `parseQuickAsk` is not certain of.
 */
/**
 * The briefing, without a model turn.
 *
 * The chat screen has a button that asks for five things: last night, today's
 * calendar, the habits still due, overdue reminders, and what has been taken
 * so far. Every one is a lookup this app already does, and it was being
 * answered by the full chat path — Opus, forty-one tool schemas and the whole
 * cached prefix — to read five sets of rows. It reports and concludes nothing,
 * like every other answer in this file.
 */
const num = (n: number) => new Intl.NumberFormat("en-GB").format(Math.round(n))

/**
 * Dollars as a person reads them, falling back to cents below a cent —
 * `$0.00` beside a real figure reads as free, and the briefing genuinely does
 * cost less than a cent a call.
 */
const cents = (n: number) => (n >= 0.01 ? `${(n * 100).toFixed(1)}c` : `${(n * 100).toFixed(2)}c`)
const money = (n: number) => (n >= 0.01 ? `$${n.toFixed(2)}` : cents(n))

/** A weight as a scale reads it: one decimal, never 78.40000000000001. */
const kg = (n: number) => `${Math.round(n * 10) / 10}kg`

async function steps(userId: string, tz: string, window: "today" | "week"): Promise<QuickAnswer> {
  const today = localDateStr(tz)
  const days = window === "week" ? 7 : 1
  const from = addDaysISO(today, -(days - 1))
  const [rows, goals] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: new Date(from + "T00:00:00Z"), lte: new Date(today + "T00:00:00Z") } },
      orderBy: { date: "asc" },
      select: { date: true, steps: true },
    }).catch(() => []),
    getGoals(userId),
  ])

  const counted: { day: string; steps: number }[] = rows
    .filter(r => r.steps != null && r.steps > 0)
    .map(r => ({ day: r.date.toISOString().slice(0, 10), steps: r.steps as number }))

  if (window === "today") {
    const row = counted.find(r => r.day === today)
    // "So far" is not decoration: the ring publishes through the day, so this
    // number is a running total and reading it as a final one is a mistake.
    if (!row) return { reply: "No steps counted today yet.", sources: [] }
    return {
      reply: `**${num(row.steps)}** steps so far today, against a goal of ${num(goals.steps)}.`,
      sources: chips({ activity: "today" }),
    }
  }

  if (counted.length === 0) return { reply: "No step counts in the last seven days.", sources: [] }

  // Today is a partial count, and mixing it into an average or letting it win
  // "fewest" would be a false comparison: at 09:00 it is the lowest day of any
  // week. It is a day that has not finished, so it is reported on its own.
  const running = counted.find(r => r.day === today)
  const done = counted.filter(r => r.day !== today)
  const sofar = running ? ` Today is at **${num(running.steps)}** and still counting.` : ""

  if (done.length === 0) {
    return { reply: `Only today has a count so far: **${num(running!.steps)}**, still counting.`, sources: chips({ activity: "today" }) }
  }

  const total = done.reduce((s, r) => s + r.steps, 0)
  const avg = total / done.length
  const most = done.reduce((a, b) => (b.steps > a.steps ? b : a))
  const least = done.reduce((a, b) => (b.steps < a.steps ? b : a))
  // Today is not a gap either, it is unfinished; counting it as missing
  // invents one, and a false gap trains you to ignore the real ones.
  const missing = Math.max(0, days - 1 - done.length)
  const gap = missing > 0 ? ` ${missing === 1 ? "One day has" : `${missing} days have`} no count.` : ""
  const over = missing > 0 ? ` across the ${done.length} with a count` : ""
  const spread = done.length > 1
    ? ` Most on ${pretty(most.day)} with ${num(most.steps)}, fewest on ${pretty(least.day)} with ${num(least.steps)}.`
    : ""

  return {
    reply: `**${num(avg)}** steps a day on average over the last week${over}, ${num(total)} in total.${gap}${spread}${sofar}`,
    sources: chips({ activity: `${done.length} days` }),
  }
}

/**
 * Caffeine in milligrams. "How much coffee today" is a question about volume
 * and is answered by `intakeTotal`; this one is about the dose, which is why
 * it reads CaffeineLog rather than IntakeLog and why it also says what is
 * still circulating — the number that decides whether tonight is affected.
 */
async function caffeineToday(userId: string, tz: string): Promise<QuickAnswer> {
  const { start, end } = zonedDayRange(tz, localDateStr(tz))
  const now = new Date()
  const [logged, recent, goals] = await Promise.all([
    prisma.caffeineLog.findMany({
      where: { userId, loggedAt: { gte: start, lte: end } },
      orderBy: { loggedAt: "asc" },
      select: { caffeineMg: true, compound: true },
    }).catch(() => []),
    // Yesterday's late cup is still being cleared, and it is part of the
    // "still circulating" figure even though it is not part of today's total.
    prisma.caffeineLog.findMany({
      where: { userId, loggedAt: { gte: new Date(now.getTime() - 36 * 3_600_000) } },
      select: { caffeineMg: true, loggedAt: true },
    }).catch(() => []),
    getGoals(userId),
  ])

  const activeMg = activeFromDoses(recent, now.getTime())
  const circulating = activeMg >= CAFFEINE_FLOOR_MG
  if (logged.length === 0) {
    return circulating
      ? { reply: `No caffeine logged today. **${activeMg}mg** is still circulating from yesterday.`, sources: chips({ intake: "36h" }) }
      : { reply: "No caffeine logged today.", sources: [] }
  }

  const total = logged.reduce((s, r) => s + r.caffeineMg, 0)
  const names = [...new Set(logged.map(r => r.compound).filter(Boolean))]
  const from = names.length > 0 ? ` from ${list(names)}` : ""
  const drinks = logged.length === 1 ? "one drink" : `${count(logged.length)} drinks`
  const still = circulating ? ` **${activeMg}mg** still circulating.` : " None of it still circulating."

  return {
    reply: `**${total}mg** of caffeine today across ${drinks}${from}, against a ${goals.coffeeMax}mg ceiling.${still}`,
    sources: chips({ intake: "today" }),
  }
}

async function weight(userId: string, tz: string, window: "latest" | "week"): Promise<QuickAnswer> {
  const today = localDateStr(tz)
  const rows = await prisma.healthLog.findMany({
    where: { userId, date: { lte: new Date(today + "T00:00:00Z") }, weight: { not: null } },
    orderBy: { date: "desc" }, take: 120,
    select: { date: true, weight: true },
  }).catch(() => [])

  const readings = rows.map(r => ({ day: r.date.toISOString().slice(0, 10), kg: r.weight! }))
  if (readings.length === 0) return { reply: "No weight recorded yet.", sources: [] }

  const latest = readings[0]

  if (window === "week") {
    const from = addDaysISO(today, -6)
    const week = readings.filter(r => r.day >= from).reverse()
    // The week asked about may hold nothing — a scale used on Sundays is
    // normal. Saying so and giving the real most recent reading beats
    // answering a different week without mentioning it.
    if (week.length === 0) {
      return {
        reply: `Nothing weighed in the last seven days. The most recent is **${kg(latest.kg)}** on ${pretty(latest.day)}.`,
        sources: chips({ weight: "1 reading" }),
      }
    }
    if (week.length === 1) {
      return {
        reply: `**${kg(week[0].kg)}** on ${pretty(week[0].day)}, the only reading in the last seven days.`,
        sources: chips({ weight: "1 reading" }),
      }
    }
    const first = week[0]
    const last = week[week.length - 1]
    const move = last.kg - first.kg
    const change = Math.abs(move) < 0.05
      ? "unchanged across the week"
      : `${move < 0 ? "down" : "up"} ${kg(Math.abs(move))} across the week`
    return {
      reply: `**${kg(last.kg)}** on ${pretty(last.day)}, ${change} from ${kg(first.kg)} on ${pretty(first.day)}. ${sentence(count(week.length))} readings in seven days.`,
      sources: chips({ weight: `${week.length} readings` }),
    }
  }

  // A weight moves over months, so the date is part of the answer: without it
  // a reading from three weeks ago passes for this morning's.
  const earlier = readings.find(r => r.day <= addDaysISO(latest.day, -7))
  const since = earlier
    ? (() => {
        const move = latest.kg - earlier.kg
        return Math.abs(move) < 0.05
          ? ` Unchanged since ${pretty(earlier.day)}.`
          : ` ${move < 0 ? "Down" : "Up"} ${kg(Math.abs(move))} from ${kg(earlier.kg)} on ${pretty(earlier.day)}.`
      })()
    : ""
  return {
    reply: `**${kg(latest.kg)}**, recorded ${latest.day === today ? "today" : `on ${pretty(latest.day)}`}.${since}`,
    sources: chips({ weight: `${readings.length} readings` }),
  }
}

/**
 * The habits still due today. A "three times a week" habit is due until its
 * third completion lands, which is why the whole week is read rather than the
 * day — the same rule the Habits page uses, through the same helpers.
 */
async function habitsLeft(userId: string, today: string): Promise<string[]> {
  const rows = await prisma.habit.findMany({
    where: { userId, isArchived: false },
    select: {
      name: true, scheduleDays: true, timesPerWeek: true,
      completions: {
        where: { date: { gte: new Date(`${weekStart(today)}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) } },
        select: { date: true },
      },
      skips: { where: { date: new Date(`${today}T00:00:00Z`) }, select: { date: true } },
    },
  }).catch(() => [])

  return rows
    .filter(h => {
      if (h.skips.length > 0) return false
      const done = new Set(h.completions.map(c => c.date.toISOString().slice(0, 10)))
      if (done.has(today)) return false
      return isDueOn(normalizeSchedule(h), today, done)
    })
    .map(h => h.name)
}

/** Today from all three calendars, in time order — the Home card's own merge. */
async function dayEvents(userId: string, tz: string) {
  const { start, end } = zonedDayRange(tz)
  const [calendarEvents, appEvents] = await Promise.all([
    getTodayEvents(userId).catch(() => []),
    loadEventOccurrences(userId, start, end, tz).catch(() => []),
  ])
  return mergeDayEvents(calendarEvents, appEvents)
}

/** An event as it is spoken: a time and a title, or "all day". */
function eventLine(tz: string) {
  const at = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false })
  return (e: { title: string; start: string | null; isAllDay: boolean }) =>
    e.isAllDay || !e.start ? `all day ${e.title}` : `${at.format(new Date(e.start))} ${e.title}`
}

async function habitsToday(userId: string, tz: string): Promise<QuickAnswer> {
  const left = await habitsLeft(userId, localDateStr(tz))
  if (left.length === 0) return { reply: "Nothing left — every habit due today is done.", sources: chips({ habits: "today" }) }
  return {
    reply: `Still due today: ${list(left)}.`,
    sources: chips({ habits: "today" }),
  }
}

async function eventsToday(userId: string, tz: string): Promise<QuickAnswer> {
  const events = await dayEvents(userId, tz)
  if (events.length === 0) return { reply: "Nothing on the calendar today.", sources: [] }
  const line = eventLine(tz)
  return {
    reply: `Today:\n\n${events.map(e => `- ${line(e)}`).join("\n")}`,
    sources: chips({ calendar: "today" }),
  }
}

/**
 * What the app has spent on models, by feature and then by effort.
 *
 * The Console gives one total for the whole organisation — it will say $8 this
 * month and cannot say whether that went on chat, the weekly review or one
 * photographed lab printout. This is the split, and the feature line comes
 * first because that is the question a surprising bill actually asks.
 *
 * The effort lines are the `EMERGY_CHAT_EFFORT` readout. The per-turn log line
 * cannot be it — this project keeps about a day of runtime logs, so a week of
 * them never exists at once — which is why every call writes a row. The arms
 * are split by the label on the row rather than by date, so the setting can be
 * moved back and forth and they still separate.
 *
 * It reports. Whether the cheaper answers were as good is not a thing a row
 * knows, and this file does not pretend otherwise.
 */
async function chatSpend(userId: string, tz: string): Promise<QuickAnswer> {
  const rows = await prisma.modelTurn.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { feature: true, effort: true, costUsd: true, outputTokens: true, createdAt: true },
  }).catch(() => [])

  if (rows.length === 0) return { reply: "No model calls recorded yet.", sources: [] }

  const day = (d: Date) => pretty(localDateStr(tz, d))
  const priced = rows.filter(r => r.costUsd != null)
  const unpriced = rows.length - priced.length
  const total = priced.reduce((s, r) => s + (r.costUsd ?? 0), 0)

  interface Bucket { turns: number; usd: number; out: number }
  const tally = (key: (r: typeof priced[number]) => string) => {
    const m = new Map<string, Bucket>()
    for (const r of priced) {
      const b = m.get(key(r)) ?? { turns: 0, usd: 0, out: 0 }
      b.turns += 1
      b.usd += r.costUsd ?? 0
      b.out += r.outputTokens
      m.set(key(r), b)
    }
    // Dearest first: the point of the split is finding where the money went.
    return [...m.entries()].sort((a, b) => b[1].usd - a[1].usd)
  }

  const line = ([label, b]: [string, Bucket]) =>
    `- **${label}**: ${money(b.usd)} over ${b.turns} ${b.turns === 1 ? "call" : "calls"}, ${cents(b.usd / b.turns)} each, ${num(Math.round(b.out / b.turns))} output tokens a call`

  const byFeature = tally(r => r.feature)
  const chatRows = priced.filter(r => r.feature === "chat")

  // The effort table is only worth printing when there are two arms in it, and
  // only for chat — the photo paths set their own effort per call, so mixing
  // them in would compare a first-pass meal guess against a chat answer.
  const chatOnly = new Map<string, Bucket>()
  for (const r of chatRows) {
    const b = chatOnly.get(r.effort) ?? { turns: 0, usd: 0, out: 0 }
    b.turns += 1
    b.usd += r.costUsd ?? 0
    b.out += r.outputTokens
    chatOnly.set(r.effort, b)
  }
  const effortLines = [...chatOnly.entries()].sort((a, b) => b[1].usd - a[1].usd)
  const effortBlock = effortLines.length >= 2
    ? `\n\nChat, by effort:\n\n${effortLines.map(line).join("\n")}`
    : chatRows.length > 0
      ? `\n\nChat has only run at **${effortLines[0][0]}** effort so far, so there is nothing to compare it against yet.`
      : ""

  const missing = unpriced > 0
    ? ` ${unpriced} ${unpriced === 1 ? "call has" : "calls have"} no price — the model was not one this app knows a rate for.`
    : ""

  return {
    reply: `Since ${day(rows[0].createdAt)}, models have cost **${money(total)}** across ${priced.length} ${priced.length === 1 ? "call" : "calls"}.${missing}\n\n${byFeature.map(line).join("\n")}${effortBlock}`,
    sources: [],
  }
}


async function briefing(userId: string, tz: string): Promise<QuickAnswer> {
  const today = localDateStr(tz)
  const { start: dayStart } = zonedDayRange(tz)

  const [health, left, overdue, doses, events] = await Promise.all([
    // The most recent night, not strictly today's: a ring publishes the night
    // once you are up, so before it syncs "no sleep data" would be the answer
    // on most mornings. Which night it is gets said when it is not last night.
    prisma.healthLog.findFirst({
      where: { userId, date: { lte: new Date(`${today}T00:00:00Z`) }, sleepDuration: { not: null } },
      orderBy: { date: "desc" },
      select: { date: true, sleepDuration: true, sleepScore: true, readinessScore: true },
    }).catch(() => null),
    habitsLeft(userId, today),
    prisma.reminder.findMany({
      where: { userId, isCompleted: false, dueDate: { lt: dayStart } },
      orderBy: { dueDate: "asc" }, take: 5, select: { title: true },
    }).catch(() => []),
    todaysDoses(userId, today),
    dayEvents(userId, tz),
  ])

  const line = eventLine(tz)

  const lines = [
    (() => {
      if (!health?.sleepDuration) return "**Last night** no night recorded yet."
      const night = health.date.toISOString().slice(0, 10)
      const figures = `${hm(health.sleepDuration)}${health.sleepScore != null ? `, score **${health.sleepScore}**` : ""}${health.readinessScore != null ? `, readiness **${health.readinessScore}**` : ""}`
      return night === today
        ? `**Last night** ${figures}.`
        : `**Last night** not synced yet. The most recent is ${pretty(night)}: ${figures}.`
    })(),
    `**Today** ${events.length === 0
      ? "nothing on the calendar."
      : `${events.slice(0, 6).map(line).join(" · ")}.`}`,
    `**Habits left** ${left.length === 0 ? "none." : `${list(left)}.`}`,
    `**Overdue** ${overdue.length === 0 ? "nothing." : `${list(overdue.map(r => r.title))}.`}`,
    `**Taken today** ${doses.length === 0 ? "nothing yet." : `${list(doses.map(d => d.label))}.`}`,
  ]

  const manifest: SourceManifest = { habits: "today", calendar: "today" }
  if (health?.sleepDuration) manifest.sleep = "last night"
  if (doses.length > 0) manifest.meds = "today"

  return { reply: lines.join("\n\n"), sources: chips(manifest) }
}

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
    case "briefing": return briefing(userId, tz)
    case "habits_today": return habitsToday(userId, tz)
    case "events_today": return eventsToday(userId, tz)
    case "steps": return steps(userId, tz, ask.window)
    case "caffeine_today": return caffeineToday(userId, tz)
    case "weight": return weight(userId, tz, ask.window)
    case "chat_spend": return chatSpend(userId, tz)
  }
}
