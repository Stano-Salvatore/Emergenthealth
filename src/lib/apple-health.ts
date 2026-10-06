// What an iPhone Shortcut sends from Apple Health, read into one day of
// HealthLog.
//
// Apple lets only a native iPhone app read Apple Health, and this app is a
// web app on the iPhone. So the iPhone's own Shortcuts app does the reading,
// on a schedule, and posts the numbers to /api/sync/apple-health. The
// shortcut is built by hand on someone's phone, in their language, so this
// reads what Shortcuts actually produces rather than what a client library
// would: a number may come as a JSON number, as "7,5" or "12 345" text, as
// "72,4 kg", or as several values joined by newlines (what Shortcuts makes of
// a list dropped into a text field). Sleep comes as the samples' start and end
// times, which only ISO 8601 makes readable in every language.
//
// Absent is not zero. A Shortcuts sum over no samples is 0 — the watch not
// synced yet looks exactly like a day without a step — so a 0 is left out,
// never stored. Anything present but unreadable is left out and named, so the
// settings card can say what to fix.

import { plausibleHeartRate, plausibleHrv } from "@/lib/vitals"

/** Every number in a value as Shortcuts writes one: a number, or text holding one per line. */
export function numbersIn(v: unknown): number[] {
  if (typeof v === "number") return Number.isFinite(v) ? [v] : []
  const lines = typeof v === "string" ? v.split(/\r?\n/) : Array.isArray(v) ? v.flatMap(x => (typeof x === "number" ? [String(x)] : typeof x === "string" ? x.split(/\r?\n/) : [])) : []
  const out: number[] = []
  for (const line of lines) {
    const token = /[-+]?\d[\d\s  .,]*/.exec(line)?.[0]
    if (!token) continue
    let s = token.replace(/[\s  ]/g, "").replace(/[.,]$/, "")
    const lastComma = s.lastIndexOf(",")
    const lastDot = s.lastIndexOf(".")
    if (lastComma >= 0 && lastDot >= 0) {
      // Both: whichever comes last is the decimal mark.
      s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "")
    } else if (lastComma >= 0) {
      // "1,234" groups thousands; "7,5" is a decimal comma.
      s = /^[-+]?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".")
    }
    const n = Number(s)
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

/** Every ISO 8601 instant in a value, one per line. Any other format is not guessed at. */
export function instantsIn(v: unknown): Date[] {
  const lines = typeof v === "string" ? v.split(/\r?\n/) : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
  const out: Date[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(line)) continue
    const t = Date.parse(line)
    if (Number.isFinite(t)) out.push(new Date(t))
  }
  return out
}

const MAX_SAMPLE_MS = 16 * 3600_000
/** Samples further apart than this are separate sleeps — a nap is not part of the night. */
const SESSION_GAP_MS = 2 * 3600_000

/** Intervals from paired starts and ends, merged where they overlap (the watch and the phone both record). */
function mergedIntervals(starts: Date[], ends: Date[]): [number, number][] {
  const pairs: [number, number][] = []
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    const a = starts[i].getTime(), b = ends[i].getTime()
    if (b > a && b - a <= MAX_SAMPLE_MS) pairs.push([a, b])
  }
  pairs.sort((x, y) => x[0] - y[0])
  const merged: [number, number][] = []
  for (const p of pairs) {
    const last = merged[merged.length - 1]
    if (last && p[0] <= last[1]) last[1] = Math.max(last[1], p[1])
    else merged.push([p[0], p[1]])
  }
  return merged
}

/**
 * The night's sleep from its samples: the longest session (samples less than
 * two hours apart), its minutes asleep, and when it began and ended. Gaps
 * awake inside it are not counted. null when nothing readable came.
 */
export function mergedSleep(starts: Date[], ends: Date[]): { minutes: number; start: Date; end: Date } | null {
  const merged = mergedIntervals(starts, ends)
  if (merged.length === 0) return null
  const sessions: [number, number][][] = []
  for (const iv of merged) {
    const cur = sessions[sessions.length - 1]
    if (cur && iv[0] - cur[cur.length - 1][1] <= SESSION_GAP_MS) cur.push(iv)
    else sessions.push([iv])
  }
  const asleep = (s: [number, number][]) => s.reduce((t, [a, b]) => t + (b - a), 0)
  const best = sessions.reduce((a, b) => (asleep(b) > asleep(a) ? b : a))
  return { minutes: Math.round(asleep(best) / 60_000), start: new Date(best[0][0]), end: new Date(best[best.length - 1][1]) }
}

function minutesIn(starts: unknown, ends: unknown): number | undefined {
  const m = mergedIntervals(instantsIn(starts), instantsIn(ends)).reduce((t, [a, b]) => t + (b - a), 0)
  return m > 0 ? Math.round(m / 60_000) : undefined
}

export interface AppleHealthFields {
  steps?: number
  sleepDuration?: number
  sleepStart?: Date
  sleepEnd?: Date
  deepSleep?: number
  remSleep?: number
  restingHR?: number
  hrv?: number
  weight?: number
  activeMinutes?: number
  caloriesBurned?: number
}

function isDay(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

const present = (v: unknown) => v != null && !(typeof v === "string" && v.trim() === "")

/**
 * One day from a shortcut's body. `today` is the user's own date, used when
 * the body names none — the shortcut runs on the day it reports.
 */
export function readAppleHealthDay(
  body: Record<string, unknown>,
  today: string,
): { date: string; fields: AppleHealthFields; ignored: string[] } {
  const fields: AppleHealthFields = {}
  const ignored: string[] = []

  /** A summed count: present and positive within range, or left out — and named if it was there but wrong. */
  const summed = (key: string, max: number): number | undefined => {
    if (!present(body[key])) return undefined
    const ns = numbersIn(body[key])
    const total = ns.reduce((a, b) => a + b, 0)
    if (ns.length > 0 && total === 0 && ns.every(n => n === 0)) return undefined // a sum over nothing
    if (ns.length === 0 || ns.some(n => n < 0) || total > max) { ignored.push(key); return undefined }
    return Math.round(total)
  }
  const averaged = (key: string, gate: (n: number) => number | null): number | undefined => {
    if (!present(body[key])) return undefined
    const ns = numbersIn(body[key]).filter(n => n !== 0)
    if (ns.length === 0) {
      if (numbersIn(body[key]).length === 0) ignored.push(key)
      return undefined
    }
    const ok = gate(ns.reduce((a, b) => a + b, 0) / ns.length)
    if (ok == null) { ignored.push(key); return undefined }
    return ok
  }

  const steps = summed("steps", 200_000)
  if (steps !== undefined) fields.steps = steps
  const exercise = summed("exerciseMinutes", 1440)
  if (exercise !== undefined) fields.activeMinutes = exercise
  const energy = summed("activeEnergy", 20_000)
  if (energy !== undefined) fields.caloriesBurned = energy

  const rhr = averaged("restingHR", plausibleHeartRate)
  if (rhr !== undefined) fields.restingHR = Math.round(rhr)
  const hrv = averaged("hrv", plausibleHrv)
  if (hrv !== undefined) fields.hrv = Math.round(hrv * 10) / 10

  if (present(body.weight)) {
    const ns = numbersIn(body.weight).filter(n => n !== 0)
    const raw = ns[ns.length - 1]
    const lb = /lb/i.test(String(body.weightUnit ?? "")) || (typeof body.weight === "string" && /lb/i.test(body.weight))
    const kg = raw === undefined ? undefined : lb ? raw * 0.45359237 : raw
    if (kg !== undefined && kg >= 20 && kg <= 400) fields.weight = Math.round(kg * 100) / 100
    else if (ns.length > 0 || numbersIn(body.weight).length === 0) ignored.push("weight")
  }

  if (present(body.sleepStarts) || present(body.sleepEnds)) {
    const s = mergedSleep(instantsIn(body.sleepStarts), instantsIn(body.sleepEnds))
    if (s && s.minutes > 0 && s.minutes <= 1440) {
      fields.sleepDuration = s.minutes
      fields.sleepStart = s.start
      fields.sleepEnd = s.end
    } else {
      ignored.push("sleep")
    }
  } else if (present(body.sleepMinutes) || present(body.sleepHours)) {
    const mins = present(body.sleepMinutes)
      ? numbersIn(body.sleepMinutes).reduce((a, b) => a + b, 0)
      : numbersIn(body.sleepHours).reduce((a, b) => a + b, 0) * 60
    if (mins > 0 && mins <= 1440) fields.sleepDuration = Math.round(mins)
    else if (mins !== 0) ignored.push("sleep")
  }
  if (fields.sleepDuration !== undefined) {
    const deep = minutesIn(body.deepStarts, body.deepEnds)
    const rem = minutesIn(body.remStarts, body.remEnds)
    if (deep !== undefined && deep <= fields.sleepDuration) fields.deepSleep = deep
    if (rem !== undefined && rem <= fields.sleepDuration) fields.remSleep = rem
  }

  return { date: isDay(body.date) ? body.date : today, fields, ignored }
}
