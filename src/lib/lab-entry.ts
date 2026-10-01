// What the manual Add Result form pre-fills, and when it should ask twice.
//
// The unit box used to fill itself with US units (mg/dL, ng/mL, %) for a user
// whose Slovak and Czech reports print mmol/l, µmol/l, nmol/l and mmol/mol.
// An unnoticed default is a value stored in the wrong unit, and the trend
// then converts it faithfully into a dramatic, fictional change.

import { canonicalMarker } from "@/lib/lab-markers"
import { convertLabValue, normalizeUnit } from "@/lib/lab-units"

/** The units a Central-European lab prints, for a marker with no history yet. */
const SI_UNITS: Record<string, string> = {
  "Vitamin D": "nmol/l",
  "TSH": "mIU/l",
  "Ferritin": "µg/l",
  "HbA1c": "mmol/mol",
  "Cholesterol": "mmol/l",
  "LDL": "mmol/l",
  "HDL": "mmol/l",
  "Triglycerides": "mmol/l",
  "Glucose": "mmol/l",
  "Creatinine": "µmol/l",
  "ALT": "µkat/l",
  "AST": "µkat/l",
  "Vitamin B12": "pmol/l",
  "Folate": "nmol/l",
  "Iron": "µmol/l",
  "CRP": "mg/l",
}

export interface PastReading {
  value: number
  unit: string
  /** YYYY-MM-DD, or anything that sorts the same way. */
  date: string
  /** A printed "<" or ">": the value is a limit, not a measurement. */
  qualifier?: string | null
}

function latest(marker: string, history: Record<string, PastReading[]>): PastReading | null {
  const list = history[canonicalMarker(marker)] ?? []
  return list.reduce<PastReading | null>((best, r) => (best == null || r.date > best.date ? r : best), null)
}

/**
 * The unit this marker was last recorded in, else the SI unit, else null.
 * Matching the last reading keeps a series in one unit; SI is what the next
 * paper report will say.
 */
export function suggestedUnit(marker: string, history: Record<string, PastReading[]>): string | null {
  const last = latest(marker, history)
  if (last?.unit) return last.unit
  return SI_UNITS[canonicalMarker(marker)] ?? null
}

/** Further apart than this, and the likelier story is a wrong unit. */
const JUMP = 5

/**
 * A typed value more than 5x away from the last reading once both are in the
 * same unit. Null when there is no last reading, or when the two units can't
 * be reconciled — a warning needs a comparison it can stand behind.
 */
export function implausibleJump(
  marker: string,
  value: number,
  unit: string,
  history: Record<string, PastReading[]>,
): { factor: number; previous: PastReading } | null {
  const previous = latest(marker, history)
  if (!previous || !Number.isFinite(value) || value <= 0 || !unit.trim()) return null
  // "<5" last time bounds the old value without fixing it — no factor follows.
  if (previous.qualifier) return null
  const was = normalizeUnit(previous.unit) === normalizeUnit(unit)
    ? previous.value
    : convertLabValue(previous.value, previous.unit, unit, canonicalMarker(marker))
  if (was == null || was <= 0) return null
  const factor = Math.max(value / was, was / value)
  return factor > JUMP ? { factor, previous } : null
}
