// The fast path: a log-shaped message answered without the model.
//
// `quick-log.ts` decides whether a message is one of these and what it means;
// this file is the half that touches the database — it gathers what the parser
// needs to know about this user (the substances they actually take, the places
// they have saved), writes the rows through the same writers Emergy's own
// tools use, and says it back in his voice.
//
// Nothing here writes anything the parser was unsure about. `runQuickLog`
// returns null on any doubt and the caller sends the message to Emergy, which
// is the behaviour every user had before this existed.

import { prisma } from "@/lib/prisma"
import { getUserTimezone } from "@/lib/user-timezone"
import { localTimeStr, zonedDayRange, localDateStr } from "@/lib/local-date"
import { hydrationMl, HYDRATING_TYPES } from "@/lib/hydration"
import { recordDrink } from "@/lib/intake-write"
import { recordDose } from "@/lib/dose-write"
import {
  looksLikeQuickLog, parseQuickLog, describeItem, joinList, timePhrase,
  type QuickItem,
} from "@/lib/quick-log"

export interface QuickLogResult {
  /** What Emergy says back — one line, already in his voice. */
  reply: string
  /** The tool names this stands in for, so the client reacts as it would to a real write. */
  tools: string[]
}

/** Substances this user actually takes: what they have logged, plus anything scheduled. */
async function knownSubstances(userId: string): Promise<string[]> {
  const [tags, schedules] = await Promise.all([
    prisma.ouraTag.findMany({
      where: { userId, tagName: { not: null } },
      select: { tagName: true },
      orderBy: { timestamp: "desc" },
      take: 400,
    }).catch(() => []),
    prisma.medSchedule.findMany({ where: { userId }, select: { name: true } }).catch(() => []),
  ])
  const names = new Set<string>()
  for (const t of tags) if (t.tagName) names.add(t.tagName)
  for (const s of schedules) names.add(s.name)
  return [...names]
}

/** The drink's note, following the convention log_usual already stores: "Cold brew @ Kaviareň Vták". */
function noteFor(item: Extract<QuickItem, { kind: "drink" }>, place: string | null): string | null {
  const base = item.note
  if (!place) return base
  return base ? `${base} @ ${place}` : `Water @ ${place}`
}

/**
 * Handle a message the parser recognises, or return null to let Emergy have it.
 *
 * The whole message parses or none of it does, and that decision is made
 * before a single row is written — so a half-understood message never lands
 * as a half-written log.
 */
export async function runQuickLog(userId: string, message: string): Promise<QuickLogResult | null> {
  if (!looksLikeQuickLog(message)) return null

  const timezone = await getUserTimezone(userId)
  const [hhmm, substances, places] = await Promise.all([
    Promise.resolve(localTimeStr(timezone)),
    knownSubstances(userId),
    prisma.savedPlace.findMany({ where: { userId }, select: { name: true } }).catch(() => []),
  ])
  const [h, m] = hhmm.split(":").map(Number)
  const localMinutes = h * 60 + m

  const parsed = parseQuickLog(message, {
    knownSubstances: substances,
    places: places.map(p => p.name),
    localMinutes,
  })
  if (!parsed) return null

  const now = Date.now()
  // One trip to the café is one time, said once — "300ml batch brew and 250ml
  // water at Kaviareň Vták, 15:00", not the same clock stamped on every item.
  const times = parsed.items.map(i => i.minutesAgo)
  const sharedTime = times.length > 1 && times[0] > 0 && times.every(t => t === times[0]) ? times[0] : null
  const said: string[] = []
  const tools: string[] = []
  let wroteHydrating = false

  for (const item of parsed.items) {
    const at = new Date(now - item.minutesAgo * 60_000)
    if (item.kind === "drink") {
      const note = noteFor(item, parsed.place)
      const written = await recordDrink({
        userId, type: item.type, amountMl: item.amountMl, note, at,
      })
      // One row failing is not a reason to claim the rest didn't happen, but it
      // is a reason not to claim this one did.
      if (!written) continue
      if (HYDRATING_TYPES.includes(item.type)) wroteHydrating = true
      said.push(describeItem(item, localMinutes, written.caffeineMg, sharedTime != null))
      tools.push(item.type === "water" ? "log_water" : item.type === "coffee" ? "log_coffee" : "log_drink")
    } else {
      const ok = await recordDose({ userId, timezone, name: item.name, dose: item.dose, at })
      if (!ok) continue
      said.push(describeItem(item, localMinutes, null, sharedTime != null))
      tools.push("log_dose")
    }
  }

  if (said.length === 0) return { reply: "That didn't save — worth trying again.", tools: [] }

  const where = parsed.place ? ` at ${parsed.place}` : ""
  // The place has already spent the sentence's "at", so the time follows it as
  // a clause rather than a second preposition.
  const stamp = sharedTime == null ? ""
    : where ? `, ${timePhrase(sharedTime, localMinutes, true)}`
    : timePhrase(sharedTime, localMinutes)
  let reply = `Logged ${joinList(said)}${where}${stamp}.`

  // The number they'd otherwise ask for next.
  if (wroteHydrating) {
    const total = await dayHydration(userId, timezone)
    if (total > 0) reply += ` That's ${total >= 1000 ? `${Math.round(total / 100) / 10}L` : `${total}ml`} of fluid today.`
  }
  return { reply, tools }
}

async function dayHydration(userId: string, timezone: string): Promise<number> {
  const { start, end } = zonedDayRange(timezone, localDateStr(timezone))
  const logs = await prisma.intakeLog.findMany({
    where: { userId, loggedAt: { gte: start, lte: end } },
    select: { type: true, amountMl: true },
  }).catch(() => [])
  return logs.reduce((sum, l) => sum + hydrationMl(l.type, l.amountMl), 0)
}
