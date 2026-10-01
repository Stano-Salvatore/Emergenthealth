// Body strain: how many of last night's signals left the user's usual band.
//
// The illness composite answers one narrow question — three of four infection
// signs on one night — and stays silent on everything else. On 1 Oct the ring
// read blood oxygen at 93.7% against a usual 97 and seventy minutes to fall
// asleep against twenty-five; Oura called it major strain, and this app said
// nothing, because none of the four infection signs had moved. This reads
// every overnight signal together and grades the night.
//
// Points, so the grading can be read off the code:
//   body sign (heart, HRV, temperature, breathing, oxygen)   2
//   sleep sign (time to fall asleep, efficiency)             1
//   far out (|z| ≥ 3)                                       +1
//   held for MIN_HELD nights or more                        +1
// Under 2 is none — one slow night of falling asleep is a bad night, not
// strain. 2–3 is minor. 4 or more is major, and the infection pattern is
// always major. Only concerning shifts count: a high HRV is not strain.

import { illnessSignal, type Anomaly } from "@/lib/anomalies"

export type StrainLevel = "none" | "minor" | "major"

const BODY_METRICS = ["restingHR", "hrv", "skinTemp", "breathingRate", "spo2"] as const
const SLEEP_METRICS = ["sleepLatency", "sleepEfficiency"] as const
export const STRAIN_METRICS: readonly string[] = [...BODY_METRICS, ...SLEEP_METRICS]

const STRONG_Z = 3
const MIN_HELD = 3
const MINOR_AT = 2
const MAJOR_AT = 4
const MAX_NAMED = 3

export interface StrainSign {
  metric: string
  label: string
  z: number
  runLength: number
  points: number
}

export interface BodyStrain {
  level: StrainLevel
  /** The night judged — Oura's wake day. */
  date: string
  signs: StrainSign[]
  /** True when the signs match the start of an infection. */
  illness: boolean
  headline: string
  summary: string
}

export interface StrainNight {
  date: string
  /** Metric keys with a reading on this night. */
  measured: string[]
  readiness: number | null
  /** Readiness itself is off its usual, in the low direction. */
  readinessLow: boolean
}

const HEADLINE: Record<StrainLevel, string> = {
  none: "No signs of strain",
  minor: "Minor signs of strain",
  major: "Major signs of strain",
}

function points(a: Anomaly): number {
  let p = (BODY_METRICS as readonly string[]).includes(a.metric) ? 2 : 1
  if (Math.abs(a.z) >= STRONG_Z) p++
  if (a.runLength >= MIN_HELD) p++
  return p
}

/** "Resting heart rate" → "resting heart rate", but "HRV" stays "HRV". */
function inSentence(label: string): string {
  return label.split(" ").map(w => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase())).join(" ")
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Grade one night from the per-metric anomalies (detectEach, before any
 * composite stands in for its parts). Null when the night measured none of
 * the strain signals: nothing read is not the same as nothing wrong.
 */
export function bodyStrain(raw: Anomaly[], night: StrainNight): BodyStrain | null {
  if (!night.measured.some(m => STRAIN_METRICS.includes(m))) return null

  const tonight = raw.filter(a => a.date === night.date && a.concerning && STRAIN_METRICS.includes(a.metric))
  const signs: StrainSign[] = tonight
    .map(a => ({ metric: a.metric, label: a.label, z: a.z, runLength: a.runLength, points: points(a) }))
    .sort((a, b) => (b.points - a.points) || (Math.abs(b.z) - Math.abs(a.z)))
  const total = signs.reduce((n, s) => n + s.points, 0)
  const illness = illnessSignal(tonight) != null

  const level: StrainLevel = illness || total >= MAJOR_AT ? "major" : total >= MINOR_AT ? "minor" : "none"

  const readiness = night.readiness == null
    ? null
    : night.readinessLow ? `Readiness is down at ${Math.round(night.readiness)}` : `Readiness looks typical at ${Math.round(night.readiness)}`

  let summary: string
  if (level === "none") {
    // A sign too small to grade still is not "nothing strayed".
    const rest = signs.length > 0
      ? `only ${inSentence(signs[0].label)} was a little off your usual last night.`
      : "nothing measured last night strayed from your usual."
    summary = readiness ? `${readiness}, and ${rest}` : capital(rest)
  } else if (illness) {
    const names = listWords(signs.filter(s => (BODY_METRICS as readonly string[]).includes(s.metric)).map(s => inSentence(s.label)))
    summary = `${readiness ? `${readiness}. ` : ""}${capital(names)} moved together, the way they do at the start of an infection. A pattern the ring sees, not a diagnosis.`
  } else {
    const named = signs.slice(0, MAX_NAMED).map(s => inSentence(s.label))
    const extra = signs.length - named.length
    const subject = extra > 0 ? `${named.join(", ")} and ${extra} more` : listWords(named)
    const verb = signs.length === 1 ? "was" : "were"
    const clause = `${subject} ${verb} off your usual last night.`
    summary = readiness ? `${readiness}, ${night.readinessLow ? "and" : "but"} ${clause}` : capital(clause)
    const held = signs.find(s => s.runLength >= MIN_HELD)
    if (held) summary += ` ${capital(inSentence(held.label))} has held there for ${held.runLength} nights.`
  }

  return { level, date: night.date, signs, illness, headline: HEADLINE[level], summary }
}
