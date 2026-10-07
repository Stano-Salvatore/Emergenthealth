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
// The night is the sleep session that ends on the day being filed (the wake
// day, as Health Connect and the ring file it). A watch stores a night as
// many short stage samples, so the shortcut sends two days of them and the
// right night is picked here: a filter on the samples' end date threw away
// everything before midnight.
//
// Absent is not zero. A Shortcuts sum over no samples is 0 — the watch not
// synced yet looks exactly like a day without a step — so a 0 is left out,
// never stored. Anything present but unreadable is left out and named, so the
// settings card can say what to fix.

import { plausibleHeartRate, plausibleHrv } from "@/lib/vitals"
import { addDaysISO, localDateStr } from "@/lib/local-date"

/**
 * How separators are read. A count (steps, minutes, kcal) is whole, so dots
 * or commas in threes group thousands — "12.345" steps is twelve thousand,
 * not twelve. A measurement (heart rate, HRV, weight, hours) takes a lone
 * comma as the decimal mark — "45,678" ms is forty-five. "auto" guesses:
 * commas in threes are thousands, a dot is decimal.
 */
export type NumberKind = "auto" | "count" | "measure"

/** Every number in a value as Shortcuts writes one: a number, or text holding one per line. */
export function numbersIn(v: unknown, kind: NumberKind = "auto"): number[] {
  if (typeof v === "number") return Number.isFinite(v) ? [v] : []
  const lines = typeof v === "string" ? v.split(/\r?\n/) : Array.isArray(v) ? v.flatMap(x => (typeof x === "number" ? [String(x)] : typeof x === "string" ? x.split(/\r?\n/) : [])) : []
  const out: number[] = []
  for (const line of lines) {
    const token = /[-+\u2212]?\d[\d\s  .,]*/.exec(line)?.[0]
    if (!token) continue
    let s = token.replace(/\u2212/g, "-").replace(/[\s  ]/g, "").replace(/[.,]$/, "")
    const lastComma = s.lastIndexOf(",")
    const lastDot = s.lastIndexOf(".")
    if (lastComma >= 0 && lastDot >= 0) {
      // Both: whichever comes last is the decimal mark.
      s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "")
    } else if (lastComma >= 0) {
      // "1,234" groups thousands; "7,5" is a decimal comma.
      const grouped = kind !== "measure" && /^[-+]?\d{1,3}(,\d{3})+$/.test(s)
      s = grouped ? s.replace(/,/g, "") : (s.match(/,/g)!.length > 1 ? "x" : s.replace(",", "."))
    } else if (lastDot >= 0 && kind === "count" && /^[-+]?\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, "")
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

export interface SleepSession { minutes: number; start: Date; end: Date }

/**
 * Every sleep in the samples: runs of samples less than two hours apart, each
 * with its minutes asleep (gaps awake inside it not counted) and when it
 * began and ended.
 */
export function sleepSessions(starts: Date[], ends: Date[]): SleepSession[] {
  const groups: [number, number][][] = []
  for (const iv of mergedIntervals(starts, ends)) {
    const cur = groups[groups.length - 1]
    if (cur && iv[0] - cur[cur.length - 1][1] <= SESSION_GAP_MS) cur.push(iv)
    else groups.push([iv])
  }
  return groups.map(g => ({
    minutes: Math.round(g.reduce((t, [a, b]) => t + (b - a), 0) / 60_000),
    start: new Date(g[0][0]),
    end: new Date(g[g.length - 1][1]),
  }))
}

/** The longest sleep in the samples, or null when nothing readable came. */
export function mergedSleep(starts: Date[], ends: Date[]): SleepSession | null {
  const all = sleepSessions(starts, ends)
  return all.length ? all.reduce((a, b) => (b.minutes > a.minutes ? b : a)) : null
}

/** Minutes of the samples that fall inside [from, to] — a stage counted only within the night it belongs to. */
function minutesWithin(starts: unknown, ends: unknown, from: Date, to: Date): number | undefined {
  const lo = from.getTime(), hi = to.getTime()
  const m = mergedIntervals(instantsIn(starts), instantsIn(ends))
    .reduce((t, [a, b]) => t + Math.max(0, Math.min(b, hi) - Math.max(a, lo)), 0)
  return m > 0 ? Math.round(m / 60_000) : undefined
}

/** The non-empty lines of a value, to tell "every time read" from "some times dropped". */
const lineCount = (v: unknown) =>
  typeof v === "string" ? v.split(/\r?\n/).filter(l => l.trim() !== "").length
  : Array.isArray(v) ? v.filter(x => typeof x === "string" && x.trim() !== "").length : 0

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
 * the body names none — the shortcut runs on the day it reports — and
 * `timeZone` theirs, to tell which night ends on that day.
 */
export function readAppleHealthDay(
  body: Record<string, unknown>,
  today: string,
  timeZone: string,
): { date: string; fields: AppleHealthFields; location: { lat: number; lng: number } | null; ignored: string[] } {
  const fields: AppleHealthFields = {}
  const ignored: string[] = []

  /** A summed count: present and positive within range, or left out — and named if it was there but wrong. */
  const summed = (key: string, max: number): number | undefined => {
    if (!present(body[key])) return undefined
    const ns = numbersIn(body[key], "count")
    const total = ns.reduce((a, b) => a + b, 0)
    if (ns.length > 0 && total === 0 && ns.every(n => n === 0)) return undefined // a sum over nothing
    if (ns.length === 0 || ns.some(n => n < 0) || total > max) { ignored.push(key); return undefined }
    return Math.round(total)
  }
  const averaged = (key: string, gate: (n: number) => number | null): number | undefined => {
    if (!present(body[key])) return undefined
    const ns = numbersIn(body[key], "measure").filter(n => n !== 0)
    if (ns.length === 0) {
      if (numbersIn(body[key], "measure").length === 0) ignored.push(key)
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
    const ns = numbersIn(body.weight, "measure").filter(n => n !== 0)
    const raw = ns[ns.length - 1]
    const lb = /lb/i.test(String(body.weightUnit ?? "")) || (typeof body.weight === "string" && /lb/i.test(body.weight))
    const kg = raw === undefined ? undefined : lb ? raw * 0.45359237 : raw
    if (kg !== undefined && kg >= 20 && kg <= 400) fields.weight = Math.round(kg * 100) / 100
    else if (ns.length > 0 || numbersIn(body.weight, "measure").length === 0) ignored.push("weight")
  }

  // A date the shortcut names is trusted only near today: a phone clock or a
  // typo can't file a day years away.
  const date = isDay(body.date) && body.date >= addDaysISO(today, -7) && body.date <= addDaysISO(today, 1) ? body.date : today

  if (present(body.sleepStarts) || present(body.sleepEnds)) {
    const starts = instantsIn(body.sleepStarts)
    const ends = instantsIn(body.sleepEnds)
    // Starts and ends pair by position. One time that can't be read shifts
    // every pair after it, so either all of them read or none are used.
    const allRead = starts.length > 0 && starts.length === lineCount(body.sleepStarts)
      && ends.length === lineCount(body.sleepEnds) && starts.length === ends.length
    if (!allRead) {
      ignored.push("sleep")
    } else {
      const night = sleepSessions(starts, ends)
        .filter(s => localDateStr(timeZone, s.end) === date && s.minutes > 0 && s.minutes <= 1440)
        .reduce<SleepSession | null>((a, b) => (!a || b.minutes > a.minutes ? b : a), null)
      // No sleep ending on this day — a run after midnight, before the night
      // is over — is nothing to file, not something wrong.
      if (night) {
        fields.sleepDuration = night.minutes
        fields.sleepStart = night.start
        fields.sleepEnd = night.end
        const deep = minutesWithin(body.deepStarts, body.deepEnds, night.start, night.end)
        const rem = minutesWithin(body.remStarts, body.remEnds, night.start, night.end)
        if (deep !== undefined && deep <= night.minutes) fields.deepSleep = deep
        if (rem !== undefined && rem <= night.minutes) fields.remSleep = rem
      }
    }
  } else if (present(body.sleepMinutes) || present(body.sleepHours)) {
    const ns = present(body.sleepMinutes) ? numbersIn(body.sleepMinutes, "measure") : numbersIn(body.sleepHours, "measure")
    const mins = ns.reduce((a, b) => a + b, 0) * (present(body.sleepMinutes) ? 1 : 60)
    if (ns.length === 0 || mins < 0 || mins > 1440) ignored.push("sleep")
    else if (mins > 0) fields.sleepDuration = Math.round(mins)
  }

  // Where the phone is, as the run saw it: both coordinates and on the globe,
  // or nothing — half a position is no position.
  let location: { lat: number; lng: number } | null = null
  if (present(body.lat) || present(body.lon)) {
    const lat = numbersIn(body.lat, "measure")[0]
    const lng = numbersIn(body.lon, "measure")[0]
    if (lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
      location = { lat, lng }
    } else {
      ignored.push("location")
    }
  }

  return { date, fields, location, ignored }
}
