// The Samsung Health history import, as pure functions so the rules can be
// tested without a database.
//
// It expects one combined CSV (date, sleep_score, sleep_efficiency,
// sleep_duration_min, steps, distance_m, calories, weight_kg…) and one mood
// CSV (date, time, mood_type). Samsung's own "Download personal data" export
// is neither: it is a folder of per-type com.samsung.shealth.*.csv files whose
// first line is metadata and whose headers are namespaced, so none of it
// parses here. Health Connect already carries what Samsung measures now.
//
// A backfill lands on rows the ring, Health Connect and the quick weight box
// have already written, so it only ever fills what is still empty — and on a
// ring row it also obeys the ring's rule (lib/health-precedence).

import { phoneFieldsRespectingRing, ringHoldsNight, PRECEDENCE_SELECT } from "@/lib/health-precedence"

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function parseLine(line: string): string[] {
  const result: string[] = []
  let field = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      inQuotes = !inQuotes
    } else if (c === "," && !inQuotes) {
      result.push(field.trim())
      field = ""
    } else {
      field += c
    }
  }
  result.push(field.trim())
  return result
}

export function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.trim().split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = parseLine(lines[0]).map(h => h.trim())
  return lines.slice(1).map(line => {
    const values = parseLine(line)
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]))
  })
}

function num(s: string | undefined): number | null {
  if (!s || s === "") return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function int(s: string | undefined): number | null {
  const n = num(s)
  return n != null ? Math.round(n) : null
}

export type CombinedFields = {
  sleepScore?: number
  sleepEfficiency?: number
  sleepDuration?: number
  steps?: number
  distanceKm?: number
  caloriesBurned?: number
  weight?: number
}

/**
 * The HealthLog columns one combined-CSV row can fill. avg_hr is not among
 * them: restingHR is the ring's average during sleep, and a day's mean over
 * every reading runs ~20 bpm higher, so storing it would put an instrument
 * change into every trend that spans the ring's arrival.
 */
export function combinedFields(row: Record<string, string>): CombinedFields {
  const sleepScore = int(row.sleep_score)
  const sleepEff   = int(row.sleep_efficiency)
  const sleepDur   = int(row.sleep_duration_min)
  const steps      = int(row.steps)
  const distanceKm = row.distance_m ? Math.round((parseFloat(row.distance_m) / 1000) * 100) / 100 : null
  const calories   = int(row.calories)
  const weightKg   = num(row.weight_kg)
  return {
    ...(sleepScore != null && sleepScore > 0 && sleepScore <= 100 && { sleepScore }),
    ...(sleepEff != null   && sleepEff > 0 && sleepEff <= 100 && { sleepEfficiency: sleepEff }),
    ...(sleepDur != null   && sleepDur > 0 && { sleepDuration: sleepDur }),
    ...(steps != null      && steps > 0 && { steps }),
    ...(distanceKm != null && distanceKm > 0 && { distanceKm }),
    ...(calories != null   && calories > 0 && { caloriesBurned: calories }),
    ...(weightKg != null   && weightKg > 0 && { weight: Math.round(weightKg * 10) / 10 }),
  }
}

/** What the route must read of an existing row before importFieldsOverExisting. */
export const IMPORT_SELECT = {
  ...PRECEDENCE_SELECT,
  sleepScore: true, sleepEfficiency: true, distanceKm: true, weight: true,
} as const satisfies Record<keyof CombinedFields, true>

type ExistingRow = Parameters<typeof phoneFieldsRespectingRing>[0] &
  Partial<Record<keyof CombinedFields, number | null>>

/**
 * The subset of `incoming` the import may write over `existing`: only
 * columns still null, never a night score beside a night the ring measured,
 * and nothing the ring's rule would refuse a phone writer.
 */
export function importFieldsOverExisting(existing: ExistingRow | null, incoming: CombinedFields): CombinedFields {
  if (!existing) return { ...incoming }
  const ringRespected: CombinedFields = phoneFieldsRespectingRing(existing, incoming)
  const out: CombinedFields = {}
  for (const key of Object.keys(ringRespected) as (keyof CombinedFields)[]) {
    if (existing[key] != null) continue
    if ((key === "sleepScore" || key === "sleepEfficiency") && ringHoldsNight(existing)) continue
    out[key] = ringRespected[key]
  }
  return out
}

const clock = (t: string) => t.replace(/^(\d):/, "0$1:")

/**
 * One mood per day from the mood CSV. A day with several entries keeps the
 * last by time, as logging again in the app replaces the earlier mood. Only a
 * plain YYYY-MM-DD date is taken: anything longer carries a time whose zone
 * the file does not state, so its day cannot be known.
 */
export function moodByDay(rows: Record<string, string>[]): Map<string, number> {
  const valid = rows
    .filter(r => r.date && ISO_DAY.test(r.date))
    .map(r => ({ date: r.date, time: r.time ?? "", mood: int(r.mood_type) }))
    .filter((r): r is { date: string; time: string; mood: number } => r.mood != null && r.mood >= 1 && r.mood <= 5)
    .sort((a, b) => (a.date + " " + clock(a.time)).localeCompare(b.date + " " + clock(b.time)))
  const out = new Map<string, number>()
  for (const r of valid) out.set(r.date, r.mood)
  return out
}
