// The coarse question: where was I *that day* — and was I away?
//
// lib/day-stops answers "where did I stop this afternoon", at café resolution.
// This answers something much blunter and much cheaper: was today a day at
// home, a day out in town, or a day somewhere else entirely; and did I sleep
// in my own bed. That is the grain sleep and mood are actually recorded at —
// MoodLog is one row per date, a sleep record is one night — so this is the
// shape that joins to them without any further guessing.
//
// It also costs almost nothing to know. Naming the café you sat in needs a fix
// every few minutes; knowing you were in Athens needs one fix all day. So this
// works on whatever points already exist, including the sparse days, and works
// backwards over history rather than only forwards from the day tracking was
// switched on.
//
// PURE — no database, no network. The caller supplies points and a timezone.

import { distanceM } from "./places"

export interface DatedPoint {
  lat: number
  lng: number
  at: Date
}

/** Inside this of home, you were home rather than out. */
const HOME_RADIUS_M = 300

/** Beyond this from home you are not in your own town any more. */
export const AWAY_KM = 30

/** Local hours whose fixes say where you slept, not where you spent the day. */
const NIGHT_UNTIL_HOUR = 5

/** Points nearer than this to each other are the same sleeping place. */
const HOME_CLUSTER_M = 250

export type DayPresence =
  /** Never left the home radius. */
  | "home"
  /** Out, but still in the home area. */
  | "local"
  /** Further than AWAY_KM from home. */
  | "away"
  /** No fixes — say so, never assume home. */
  | "unknown"

export interface DayLocation {
  /** Local YYYY-MM-DD. */
  date: string
  presence: DayPresence
  /**
   * Where the night that ENDED this morning was spent — the same night a sleep
   * record for this date describes, so the two join directly.
   */
  slept: "home" | "away" | "unknown"
  points: number
  /**
   * Distinct local hours that had at least one fix — 0 to 24.
   *
   * The honest measure of whether tracking worked that day. Two points at 9am
   * and 9pm is not a tracked day, and counting points alone cannot tell the
   * difference between that and a day covered end to end.
   */
  hoursWithFixes: number
  maxKmFromHome: number | null
  /** Centre of the day's fixes, for naming the place later. */
  lat: number | null
  lng: number | null
  /**
   * Centre of the night fixes that were AWAY from home — the bed that was not
   * your own, when there was one.
   *
   * This is what names a trip. The mean of a travel day sits halfway down the
   * motorway, so geocoding it returns a field between two countries; even the
   * mean of the whole night drags towards home on the day you set off. The
   * away fixes alone sit in the hotel.
   */
  awayNightLat: number | null
  awayNightLng: number | null
}

export interface Home {
  lat: number
  lng: number
  /** Distinct nights that voted for this spot. */
  nights: number
  /** Share of all nights with data — low means the home guess is weak. */
  share: number
}

export interface Trip {
  /** First and last local date away, inclusive. */
  start: string
  end: string
  /**
   * Nights slept away. Counted from night fixes where they exist; where a trip
   * has none it falls back to one night per day boundary inside the run.
   */
  nights: number
  days: string[]
  /** Days inside the run with no fixes at all, bridged rather than splitting. */
  gapDays: number
  /**
   * Centre of the trip, for reverse-geocoding a name once per trip: where the
   * nights were spent when there are any, otherwise the mean of the days.
   */
  lat: number
  lng: number
  maxKmFromHome: number
}

/** One Intl formatter for the whole pass — building one per point is slow. */
function zonedReader(timezone: string): (at: Date) => { date: string; hour: number } {
  let fmt: Intl.DateTimeFormat
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    })
  } catch {
    return (at) => ({ date: at.toISOString().slice(0, 10), hour: at.getUTCHours() })
  }
  return (at) => {
    const p: Record<string, string> = {}
    for (const part of fmt.formatToParts(at)) {
      if (part.type !== "literal") p[part.type] = part.value
    }
    // Some ICU builds render midnight as hour 24 under hour12:false.
    return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 }
  }
}

/**
 * Home, worked out rather than configured: the spot the most *nights* were
 * spent at.
 *
 * Counting nights and not fixes on purpose. A hotel that logged four hundred
 * points over one weekend would otherwise outvote a bedroom that logged thirty
 * over thirty nights.
 */
export function estimateHome(points: DatedPoint[], timezone: string): Home | null {
  const read = zonedReader(timezone)
  const night = points.filter(p => read(p.at).hour < NIGHT_UNTIL_HOUR)
  if (night.length === 0) return null

  const clusters: { lat: number; lng: number; n: number; nights: Set<string> }[] = []
  for (const p of night) {
    const date = read(p.at).date
    const hit = clusters.find(c => distanceM(c.lat, c.lng, p.lat, p.lng) <= HOME_CLUSTER_M)
    if (hit) {
      // Keep the running centre, so the cluster drifts to the middle of the bed
      // rather than staying anchored on whichever fix arrived first.
      hit.lat = (hit.lat * hit.n + p.lat) / (hit.n + 1)
      hit.lng = (hit.lng * hit.n + p.lng) / (hit.n + 1)
      hit.n += 1
      hit.nights.add(date)
    } else {
      clusters.push({ lat: p.lat, lng: p.lng, n: 1, nights: new Set([date]) })
    }
  }

  const allNights = new Set(night.map(p => read(p.at).date)).size
  let best = clusters[0]
  for (const c of clusters) {
    if (c.nights.size > best.nights.size) best = c
    else if (c.nights.size === best.nights.size && c.n > best.n) best = c
  }
  return {
    lat: best.lat,
    lng: best.lng,
    nights: best.nights.size,
    share: allNights === 0 ? 0 : best.nights.size / allNights,
  }
}

/**
 * One row per local day that has fixes, oldest first.
 *
 * Days with no fixes are simply absent — the caller decides whether a hole in
 * the record is a hole or a day at home, and it must never be assumed to be
 * home. Reading silence as "he was in" would put every untracked day on the
 * home side of every correlation.
 */
export function summariseDays(
  points: DatedPoint[],
  timezone: string,
  home: { lat: number; lng: number } | null,
): DayLocation[] {
  const read = zonedReader(timezone)
  const byDay = new Map<string, {
    pts: DatedPoint[]; nightAway: boolean; nightPts: number
    awayNightLat: number; awayNightLng: number; awayNightPts: number
    hours: Set<number>
  }>()

  for (const p of points) {
    const { date, hour } = read(p.at)
    let day = byDay.get(date)
    if (!day) {
      day = {
        pts: [], nightAway: false, nightPts: 0,
        awayNightLat: 0, awayNightLng: 0, awayNightPts: 0, hours: new Set(),
      }
      byDay.set(date, day)
    }
    day.pts.push(p)
    day.hours.add(hour)
    if (hour < NIGHT_UNTIL_HOUR) {
      day.nightPts += 1
      if (home && distanceM(home.lat, home.lng, p.lat, p.lng) > HOME_RADIUS_M) {
        day.nightAway = true
        day.awayNightLat += p.lat
        day.awayNightLng += p.lng
        day.awayNightPts += 1
      }
    }
  }

  const out: DayLocation[] = []
  for (const [date, day] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let maxM = 0
    let sumLat = 0
    let sumLng = 0
    for (const p of day.pts) {
      sumLat += p.lat
      sumLng += p.lng
      if (home) maxM = Math.max(maxM, distanceM(home.lat, home.lng, p.lat, p.lng))
    }
    const maxKm = home ? maxM / 1000 : null
    const presence: DayPresence =
      maxKm === null ? "unknown"
        : maxKm > AWAY_KM ? "away"
        : maxM > HOME_RADIUS_M ? "local"
        : "home"
    out.push({
      date,
      presence,
      slept: day.nightPts === 0 ? "unknown" : day.nightAway ? "away" : "home",
      points: day.pts.length,
      hoursWithFixes: day.hours.size,
      maxKmFromHome: maxKm === null ? null : Math.round(maxKm * 10) / 10,
      lat: sumLat / day.pts.length,
      lng: sumLng / day.pts.length,
      awayNightLat: day.awayNightPts === 0 ? null : day.awayNightLat / day.awayNightPts,
      awayNightLng: day.awayNightPts === 0 ? null : day.awayNightLng / day.awayNightPts,
    })
  }
  return out
}

/**
 * Fill the calendar between the first and last summarised day, so a day the
 * phone recorded nothing on is present and explicitly `unknown` rather than
 * quietly missing. Trip detection needs this to tell a gap from an ending.
 */
export function fillMissingDays(days: DayLocation[], from?: string, to?: string): DayLocation[] {
  const first = from ?? days[0]?.date
  const last = to ?? days[days.length - 1]?.date
  if (!first || !last) return []
  const have = new Map(days.map(d => [d.date, d]))
  const out: DayLocation[] = []
  const step = (iso: string, n: number) => {
    const [y, m, d] = iso.split("-").map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    dt.setUTCDate(dt.getUTCDate() + n)
    return dt.toISOString().slice(0, 10)
  }
  for (let date = first; date <= last; date = step(date, 1)) {
    out.push(have.get(date) ?? {
      date, presence: "unknown", slept: "unknown",
      points: 0, hoursWithFixes: 0, maxKmFromHome: null,
      lat: null, lng: null, awayNightLat: null, awayNightLng: null,
    })
  }
  return out
}

/**
 * Runs of days spent away from home — "Prague, 4th to the 8th".
 *
 * A day with no fixes *between* two away days is treated as part of the trip:
 * the phone dying in Athens does not mean you came home for a day and went
 * back. An unknown day at either end is not — that would be inventing travel.
 * Single days out and back again are excluded; a trip has a night in it.
 */
export function detectTrips(days: DayLocation[]): Trip[] {
  const filled = fillMissingDays(days)
  const away = filled.map(d => d.presence === "away")

  // Bridge gaps: an unknown day is away only if flanked by away on both sides.
  for (let i = 0; i < filled.length; i++) {
    if (filled[i].presence !== "unknown") continue
    let before = i - 1
    while (before >= 0 && filled[before].presence === "unknown") before--
    let after = i + 1
    while (after < filled.length && filled[after].presence === "unknown") after++
    if (before >= 0 && after < filled.length && away[before] && away[after]) away[i] = true
  }

  const trips: Trip[] = []
  let i = 0
  while (i < filled.length) {
    if (!away[i]) { i++; continue }
    let j = i
    while (j + 1 < filled.length && away[j + 1]) j++
    const run = filled.slice(i, j + 1)
    const withFixes = run.filter(d => d.points > 0)
    const sleptAway = run.filter(d => d.slept === "away").length
    const nights = sleptAway > 0 ? sleptAway : run.length - 1
    if (nights >= 1 && withFixes.length > 0) {
      let sumLat = 0, sumLng = 0, weight = 0, maxKm = 0
      let nightLat = 0, nightLng = 0, nightWeight = 0
      for (const d of withFixes) {
        sumLat += (d.lat as number) * d.points
        sumLng += (d.lng as number) * d.points
        weight += d.points
        maxKm = Math.max(maxKm, d.maxKmFromHome ?? 0)
        if (d.awayNightLat != null && d.awayNightLng != null) {
          nightLat += d.awayNightLat
          nightLng += d.awayNightLng
          nightWeight += 1
        }
      }
      trips.push({
        start: run[0].date,
        end: run[run.length - 1].date,
        nights,
        days: run.map(d => d.date),
        gapDays: run.length - withFixes.length,
        lat: nightWeight > 0 ? nightLat / nightWeight : sumLat / weight,
        lng: nightWeight > 0 ? nightLng / nightWeight : sumLng / weight,
        maxKmFromHome: maxKm,
      })
    }
    i = j + 1
  }
  return trips
}

// ─── Away versus home, against the numbers ───────────────────────────────────

export interface DayMetrics {
  sleepHours: number | null
  readiness: number | null
  hrv: number | null
  mood: number | null
}

export interface Side {
  /** Days (or nights) on this side that had any data at all. */
  n: number
  sleepHours: number | null
  readiness: number | null
  hrv: number | null
  mood: number | null
}

function mean(xs: (number | null | undefined)[]): number | null {
  const ok = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x))
  if (ok.length === 0) return null
  return ok.reduce((a, b) => a + b, 0) / ok.length
}

function side(dates: string[], metrics: Map<string, DayMetrics>): Side {
  const rows = dates.map(d => metrics.get(d)).filter((m): m is DayMetrics => m !== undefined)
  return {
    n: rows.length,
    sleepHours: mean(rows.map(r => r.sleepHours)),
    readiness: mean(rows.map(r => r.readiness)),
    hrv: mean(rows.map(r => r.hrv)),
    mood: mean(rows.map(r => r.mood)),
  }
}

/**
 * Two splits, because two different questions hide inside "does being away
 * affect me".
 *
 * Sleep, readiness and HRV are measured over a night and reported the morning
 * after, so they belong to where the night was spent — `nights`. Mood is a
 * thing about a day, so it belongs to where the day was spent — `days`.
 * Splitting both the same way would file a mood from a Tuesday at home under
 * the hotel you woke up in.
 *
 * Days the phone has nothing to say about are left out of both sides. A day
 * with no fixes is not evidence of being home.
 */
export function awayVsHome(
  days: DayLocation[],
  metrics: Map<string, DayMetrics>,
): { nights: { away: Side; home: Side }; days: { away: Side; home: Side } } {
  return {
    nights: {
      away: side(days.filter(d => d.slept === "away").map(d => d.date), metrics),
      home: side(days.filter(d => d.slept === "home").map(d => d.date), metrics),
    },
    days: {
      away: side(days.filter(d => d.presence === "away").map(d => d.date), metrics),
      home: side(
        days.filter(d => d.presence === "home" || d.presence === "local").map(d => d.date),
        metrics,
      ),
    },
  }
}

// ─── One source against another ──────────────────────────────────────────────

export interface Agreement {
  /** Days both sources had something to say about. */
  bothDays: number
  /** Of those, days they put you in the same category. */
  agreeDays: number
  /** Days only the first source covered, and only the second. */
  onlyA: number
  onlyB: number
  disagreements: { date: string; a: DayPresence; b: DayPresence }[]
}

/**
 * How two sources of location compare — the app's own tracking against a
 * Google Timeline import, say.
 *
 * Worth having because agreement is the only cheap way to find out whether
 * background tracking is actually working. A week where Google saw you out
 * and the app saw nothing is a week the app was asleep, and no amount of
 * staring at the app's own numbers would say so.
 */
export function agreementBetween(a: DayLocation[], b: DayLocation[]): Agreement {
  const byDateA = new Map(a.filter(d => d.points > 0).map(d => [d.date, d]))
  const byDateB = new Map(b.filter(d => d.points > 0).map(d => [d.date, d]))

  let bothDays = 0
  let agreeDays = 0
  const disagreements: { date: string; a: DayPresence; b: DayPresence }[] = []
  for (const [date, dayA] of byDateA) {
    const dayB = byDateB.get(date)
    if (!dayB) continue
    bothDays++
    if (dayA.presence === dayB.presence) agreeDays++
    else disagreements.push({ date, a: dayA.presence, b: dayB.presence })
  }
  disagreements.sort((x, y) => x.date.localeCompare(y.date))

  return {
    bothDays,
    agreeDays,
    onlyA: [...byDateA.keys()].filter(d => !byDateB.has(d)).length,
    onlyB: [...byDateB.keys()].filter(d => !byDateA.has(d)).length,
    disagreements,
  }
}
