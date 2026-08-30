// The day as a sentence: at home, walking, on a bus, at the café, at the bar.
//
// lib/day-stops already answers "where did I stop" — the dots on the map. What
// it cannot say is what happened BETWEEN two dots, and that is most of what
// makes a day readable. A map with three markers on it does not tell you that
// the second one was twenty minutes' walk from the first and the third was six
// kilometres on a bus.
//
// So this fills in the gaps between the stops, literally: every stretch of
// track that is not a stop becomes a move with a distance, a duration and a
// guess at how it was travelled. The result alternates — stay, move, stay,
// move — and reads top to bottom like Google's Timeline.
//
// On honesty about the mode. Speed separates walking from cycling from a road
// vehicle cleanly; it does not separate a bus from a car, because they drive
// the same roads at the same speeds. Nothing in a GPS trace reliably does.
// Every mode here therefore carries how much it should be believed:
//
//   "known"  — a Strava activity or the user's own correction covers this move
//   "likely" — the speed is well inside one band and the fixes are dense
//   "guess"  — near a threshold, sparsely sampled, or a bus/car coin-flip
//
// The UI shows the difference. A wrong label the user can see is a guess and
// can correct is fine; a wrong label presented as fact is what makes a
// timeline stop being worth reading.

import { distanceM as metresBetween } from "@/lib/places"
import type { Stop, TimedPoint } from "@/lib/day-stops"

export type TravelMode =
  | "walk"
  | "run"
  | "cycle"
  | "transit"
  | "drive"
  | "train"
  | "flight"
  | "unknown"

export type ModeConfidence = "known" | "likely" | "guess"

/** Walking pace, generously: a hurried walk tops out around here. */
export const WALK_MAX_KMH = 7

/** City cycling sits well under this; an e-bike or a fast descent reaches it. */
export const CYCLE_MAX_KMH = 22

/** Above this a road vehicle is out of its depth and it is rail or air. */
export const ROAD_MAX_KMH = 95

/** Fast rail. Above it, and far enough, the only thing left is a plane. */
export const TRAIN_MAX_KMH = 200

/** Slower than this counts as not moving, when looking for a vehicle's stops. */
const PAUSE_KMH = 5

/** A vehicle stop is seconds, not a break: outside this range it is something else. */
const PAUSE_MIN_SEC = 20
const PAUSE_MAX_SEC = 5 * 60

/** Fixes at least this often to trust anything about a move's shape. */
const DENSE_LEG_SEC = 180

/** Below these, a "move" is GPS drift between two halves of one stay. */
const MIN_MOVE_M = 150
const MIN_MOVE_MIN = 2

/**
 * Above this a leg is a bad fix rather than a record.
 *
 * Four times day-stops' own ceiling, deliberately. That one describes a track
 * on the ground, where 300 km/h can only be an error; this one has to classify
 * a flight, and an airliner cruises at 900. Sharing the lower number made the
 * flight branch below unreachable: every leg of a real flight was thrown away
 * as implausible, the move came out with no legs at all, and a trip to Athens
 * read as "unknown".
 *
 * A bad fix that happens to land in the airliner range is caught by distance
 * instead — nothing inside a city accumulates the hundred kilometres the
 * flight branch also requires.
 */
const IMPLAUSIBLE_KMH = 1200

/** A stationary phone still reports movement; under this, nothing happened. */
const NOISE_FLOOR_M = 25

/**
 * A silence this long is not a journey, it is an absence of data.
 *
 * Same hour as day-stops' STOP_MAX_GAP_MIN, and for the same reason: bridging
 * it would draw a confident line through hours nobody observed.
 */
export const JOURNEY_GAP_MIN = 60

export interface JourneyStay {
  kind: "stay"
  start: Date
  end: Date
  minutes: number
  lat: number
  lon: number
  points: number
}

export interface JourneyMove {
  kind: "move"
  start: Date
  end: Date
  minutes: number
  mode: TravelMode
  confidence: ModeConfidence
  distanceM: number
  /** 85th percentile speed, time-weighted — the pace it held, not its worst fix. */
  topKmh: number
  /** Door to door, stops at lights included. */
  avgKmh: number
  /** Brief interior halts — a bus's stops, a car's red lights. Kept on the
   *  segment because the bus/car lean needs it again when an activity span
   *  later says "vehicle" over a move speed had called something else. */
  pauses: number
}

export interface JourneyGap {
  kind: "gap"
  start: Date
  end: Date
  minutes: number
}

export type JourneySegment = JourneyStay | JourneyMove | JourneyGap

export interface MoveStats {
  distanceM: number
  minutes: number
  topKmh: number
  avgKmh: number
  /** Brief halts inside the move — a bus's stops, or a car's red lights. */
  pauses: number
  /** How often the phone reported. Sparse fixes make every shape a guess. */
  medianLegSec: number
}

interface Leg {
  metres: number
  seconds: number
  kmh: number
}

function legsOf(points: TimedPoint[]): Leg[] {
  const legs: Leg[] = []
  for (let i = 1; i < points.length; i++) {
    const seconds = (points[i].time.getTime() - points[i - 1].time.getTime()) / 1000
    if (seconds <= 0) continue
    const metres = metresBetween(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon)
    const kmh = (metres / seconds) * 3.6
    // Dropped rather than clamped: a wild fix is not a record of going fast.
    if (kmh > IMPLAUSIBLE_KMH) continue
    legs.push({ metres, seconds, kmh })
  }
  return legs
}

/**
 * The speed a move actually held, as a time-weighted 85th percentile.
 *
 * A plain maximum reports the single worst fix — one bad point turns a walk
 * into a drive. A plain mean reports the red lights as if they were the
 * journey. Weighting by how long each leg lasted, and then taking the 85th
 * percentile, describes the pace it sustained: brief stops cannot drag it
 * down, and a single outlier leg cannot lift it.
 */
export function weightedPercentileKmh(legs: Leg[], p: number): number {
  if (legs.length === 0) return 0
  const sorted = [...legs].sort((a, b) => a.kmh - b.kmh)
  const total = sorted.reduce((s, l) => s + l.seconds, 0)
  if (total <= 0) return 0
  let seen = 0
  for (const leg of sorted) {
    seen += leg.seconds
    if (seen >= total * p) return leg.kmh
  }
  return sorted[sorted.length - 1].kmh
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Interior halts: a run of near-stationary legs, bounded on both sides by
 * movement, lasting seconds rather than minutes.
 *
 * Bounded on both sides deliberately — the slow crawl away from a kerb at the
 * start of a move, and the slow arrival at its end, are not stops along the
 * way, and counting them would make every short hop look like a bus route.
 */
function countPauses(legs: Leg[]): number {
  let pauses = 0
  let runSec = 0
  let sawMovementBefore = false

  for (const leg of legs) {
    if (leg.kmh < PAUSE_KMH) {
      runSec += leg.seconds
      continue
    }
    if (sawMovementBefore && runSec >= PAUSE_MIN_SEC && runSec <= PAUSE_MAX_SEC) pauses++
    runSec = 0
    sawMovementBefore = true
  }
  // A run still open at the end is the arrival, not a stop along the way.
  return pauses
}

/** Everything measurable about a stretch of movement, in one pass. */
export function moveStats(points: TimedPoint[]): MoveStats {
  const legs = legsOf(points)
  const minutes =
    points.length >= 2
      ? (points[points.length - 1].time.getTime() - points[0].time.getTime()) / 60_000
      : 0

  // The noise floor applies to DISTANCE only. A stationary phone's jitter is
  // not travel, but the seconds it spans are still real time that passed, and
  // dropping them would make the average speed of a slow move come out fast.
  const distanceM = legs.reduce((s, l) => s + (l.metres < NOISE_FLOOR_M ? 0 : l.metres), 0)

  return {
    distanceM,
    minutes,
    topKmh: weightedPercentileKmh(legs, 0.85),
    avgKmh: minutes > 0 ? distanceM / 1000 / (minutes / 60) : 0,
    pauses: countPauses(legs),
    medianLegSec: median(legs.map(l => l.seconds)),
  }
}

/**
 * Transit or drive, for a move known to be a road vehicle.
 *
 * A bus and a car are indistinguishable by speed, so this leans on the one
 * thing that differs: a bus stops for passengers every few hundred metres,
 * all the way along, and a car only stops where the lights are. It is a lean,
 * not a determination — every caller keeps the confidence at "guess".
 *
 * Shared between inference and the known-mode overlay: when an activity span
 * says only "in a vehicle", this is what turns that into a label without
 * pretending the bus/car question got answered.
 */
export function roadVehicleLean(
  distanceM: number,
  topKmh: number,
  pauses: number,
  dense: boolean,
): TravelMode {
  const km = Math.max(0.3, distanceM / 1000)
  const urban = distanceM < 15_000 && topKmh <= 50
  return dense && urban && pauses / km >= 0.6 ? "transit" : "drive"
}

/**
 * How a stretch of movement was probably travelled.
 *
 * Speed does the work, because speed is the only thing a GPS trace measures
 * that separates the modes at all. Where it genuinely cannot decide — a bus
 * and a car on the same street — the result says so rather than picking a
 * side and sounding certain about it.
 */
export function inferMode(s: MoveStats): { mode: TravelMode; confidence: ModeConfidence } {
  if (s.distanceM < MIN_MOVE_M || s.minutes < MIN_MOVE_MIN) {
    return { mode: "unknown", confidence: "guess" }
  }

  const dense = s.medianLegSec > 0 && s.medianLegSec <= DENSE_LEG_SEC
  const near = (v: number, edge: number) => Math.abs(v - edge) / edge < 0.15
  const top = s.topKmh

  if (top < WALK_MAX_KMH) {
    return { mode: "walk", confidence: dense && !near(top, WALK_MAX_KMH) ? "likely" : "guess" }
  }

  if (top < CYCLE_MAX_KMH) {
    return { mode: "cycle", confidence: dense && !near(top, CYCLE_MAX_KMH) ? "likely" : "guess" }
  }

  if (top < ROAD_MAX_KMH) {
    return { mode: roadVehicleLean(s.distanceM, top, s.pauses, dense), confidence: "guess" }
  }

  // Far as well as fast. A handful of scattered fixes across a city can
  // average an implausible speed; a flight cannot happen in four kilometres.
  if (top < TRAIN_MAX_KMH || s.distanceM < 100_000) {
    return { mode: "train", confidence: s.distanceM > 5_000 ? "likely" : "guess" }
  }
  return { mode: "flight", confidence: "likely" }
}

/** Points inside a closed time window, bounds included. */
function pointsBetween(points: TimedPoint[], from: Date, to: Date): TimedPoint[] {
  return points.filter(p => p.time.getTime() >= from.getTime() && p.time.getTime() <= to.getTime())
}

/**
 * One stretch of track between two stops, split wherever tracking went quiet.
 *
 * A move and a gap are different claims. "You travelled six kilometres" and
 * "we have no idea where you were for two hours" must not render the same, so
 * a silence is cut out and labelled rather than being averaged into the
 * journey either side of it.
 */
function movesFrom(points: TimedPoint[], gapMin: number): JourneySegment[] {
  const out: JourneySegment[] = []
  let run: TimedPoint[] = []

  const flush = () => {
    if (run.length >= 2) {
      const stats = moveStats(run)
      const { mode, confidence } = inferMode(stats)
      out.push({
        kind: "move",
        start: run[0].time,
        end: run[run.length - 1].time,
        minutes: Math.round(stats.minutes),
        mode,
        confidence,
        distanceM: Math.round(stats.distanceM),
        topKmh: Math.round(stats.topKmh * 10) / 10,
        avgKmh: Math.round(stats.avgKmh * 10) / 10,
        pauses: stats.pauses,
      })
    }
    run = []
  }

  for (const p of points) {
    const prev = run[run.length - 1]
    if (prev) {
      const gap = (p.time.getTime() - prev.time.getTime()) / 60_000
      if (gap > gapMin) {
        flush()
        out.push({
          kind: "gap",
          start: prev.time,
          end: p.time,
          minutes: Math.round(gap),
        })
      }
    }
    run.push(p)
  }
  flush()

  return out
}

/**
 * The day, in order: stays from the detected stops, moves for everything in
 * between, gaps where nothing was recorded.
 *
 * `points` and `stops` must both be in time order — `stops` as lib/day-stops
 * returns them, which is where they should come from.
 */
export function buildJourney(
  points: TimedPoint[],
  stops: Stop[],
  opts: { gapMin?: number } = {},
): JourneySegment[] {
  if (points.length === 0) return []
  const gapMin = opts.gapMin ?? JOURNEY_GAP_MIN

  const first = points[0].time
  const last = points[points.length - 1].time
  const out: JourneySegment[] = []
  let cursor = first

  for (const stop of stops) {
    // Everything between where we left off and this stop's first fix. The
    // bounds are inclusive, so the previous stay's last point and this stay's
    // first point anchor the move at both ends and its distance is the real
    // door-to-door one rather than the middle of it.
    if (stop.start.getTime() > cursor.getTime()) {
      out.push(...movesFrom(pointsBetween(points, cursor, stop.start), gapMin))
    }
    out.push({
      kind: "stay",
      start: stop.start,
      end: stop.end,
      minutes: stop.minutes,
      lat: stop.lat,
      lon: stop.lon,
      points: stop.points,
    })
    cursor = stop.end
  }

  if (last.getTime() > cursor.getTime()) {
    out.push(...movesFrom(pointsBetween(points, cursor, last), gapMin))
  }

  // A "move" of eighty metres between two stays is one stay that drifted, not
  // a journey. Dropping it leaves the two stays adjacent, which is honest:
  // something moved slightly, and we are not going to narrate it.
  return out.filter(
    seg => seg.kind !== "move" || seg.distanceM >= MIN_MOVE_M || seg.minutes >= MIN_MOVE_MIN,
  )
}

/**
 * A stretch of the day whose mode is not a guess: a Strava activity, or the
 * user telling us what it was.
 */
export interface KnownMode {
  start: Date
  end: Date
  mode: TravelMode
  /**
   * The source could only say "in a vehicle" — the phone's sensors, or a
   * Timeline segment whose map-matching gave up. Bus vs car stays open, so
   * the overlay refines the move rather than asserting a mode: a walk that
   * was really a tram gets corrected, a transit lean stays a transit lean,
   * and the confidence stays "guess" because the question is still open.
   */
  vehicleOnly?: boolean
}

/** Strava's activity types, in this vocabulary. Unknown types stay unknown. */
export function stravaMode(type: string): TravelMode | null {
  switch (type) {
    case "Run":
    case "TrailRun":
    case "VirtualRun":
      return "run"
    case "Walk":
    case "Hike":
      return "walk"
    case "Ride":
    case "VirtualRide":
    case "EBikeRide":
    case "GravelRide":
    case "MountainBikeRide":
      return "cycle"
    default:
      return null
  }
}

/** How much of `move` falls inside `known`, as a fraction of the move. */
function overlapFraction(move: { start: Date; end: Date }, known: KnownMode): number {
  const span = move.end.getTime() - move.start.getTime()
  if (span <= 0) return 0
  const from = Math.max(move.start.getTime(), known.start.getTime())
  const to = Math.min(move.end.getTime(), known.end.getTime())
  return Math.max(0, to - from) / span
}

/**
 * Replace guessed modes with ones we actually know.
 *
 * A move has to be mostly covered before an activity claims it: a run that
 * finishes two minutes into an hour's drive says nothing about the drive, and
 * letting a brief overlap relabel the whole segment would turn the one
 * trustworthy signal here into the least trustworthy one. Where several
 * activities qualify, the one covering most of the move wins.
 */
export function applyKnownModes(
  segments: JourneySegment[],
  known: KnownMode[],
  minOverlap = 0.5,
): JourneySegment[] {
  if (known.length === 0) return segments
  return segments.map(seg => {
    if (seg.kind !== "move") return seg
    let best: { known: KnownMode; fraction: number } | null = null
    for (const k of known) {
      const fraction = overlapFraction(seg, k)
      if (fraction < minOverlap) continue
      // A definite mode beats a vehicle-only claim at any overlap that
      // qualifies: "IN_BUS" from Timeline outranks "in some vehicle" from the
      // accelerometer even when the latter covers a little more of the move.
      if (!best) { best = { known: k, fraction }; continue }
      const bestDefinite = !best.known.vehicleOnly
      const thisDefinite = !k.vehicleOnly
      if (thisDefinite && !bestDefinite) best = { known: k, fraction }
      else if (thisDefinite === bestDefinite && fraction > best.fraction) best = { known: k, fraction }
    }
    if (!best) return seg

    if (!best.known.vehicleOnly) {
      return { ...seg, mode: best.known.mode, confidence: "known" as const }
    }

    // Vehicle-only: the one certainty is that this was NOT on foot or a
    // bicycle. A move already labelled as a vehicle keeps its label and its
    // lean; one speed had called walking or cycling — the tram crawling
    // through traffic — becomes a vehicle, with transit-vs-drive decided by
    // the same pause lean inference uses, and stays a guess because that is
    // what it still is.
    if (seg.mode === "transit" || seg.mode === "drive" || seg.mode === "train" || seg.mode === "flight") {
      return seg
    }
    const mode = roadVehicleLean(seg.distanceM, seg.topKmh, seg.pauses, true)
    return { ...seg, mode, confidence: "guess" as const }
  })
}

/**
 * Where a user's correction to an inferred travel mode lives.
 *
 * A UserPreference rather than a column, because a correction annotates a
 * segment that is recomputed from raw points on every read — there is no row
 * to hang it off. Keyed by the local day first and the segment's start instant
 * second, so reading one day's corrections stays one prefix scan however many
 * years of them build up.
 *
 * Built here rather than in the two routes that need it, because a reader and
 * a writer that disagree about this string fail silently: the correction is
 * saved, and the next read simply never finds it.
 */
export const MODE_FIX_PREFIX = "journey_mode:"

export function modeFixKey(localDate: string, startIso: string): string {
  return `${MODE_FIX_PREFIX}${localDate}:${startIso}`
}

/** The modes a user may correct a move to. Anything else is not a travel mode. */
export const CORRECTABLE_MODES: TravelMode[] = [
  "walk", "run", "cycle", "transit", "drive", "train", "flight",
]

export function isCorrectableMode(v: unknown): v is TravelMode {
  return typeof v === "string" && (CORRECTABLE_MODES as string[]).includes(v)
}
