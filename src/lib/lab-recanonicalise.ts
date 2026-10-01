// A tidy for lab rows saved before the marker map learned what it knows now.
//
// Every write canonicalises on the server since 3.8.0, but rows saved earlier
// keep the names they were given then: "LDL-cholesterol" as a series of its
// own, "Vitamín D" from a chat photo beside "Vitamin D". Renaming those is
// safe, because the new name is what the same row would get if saved today.
//
// What a name can't settle is left to a person, and only shown:
// - a rename that would put two results under one name on one day — merging
//   them would pick a value nobody chose;
// - "Urea" in mg/dL, which is almost always BUN from a US report (BUN reads
//   about 2.14× lower than urea, and a series mixing the two invents a change);
// - two results under one name on one day already, which is how HDL or LDL
//   filed under "Cholesterol" by the old prefix match looks now that the
//   printed name is gone.
//
// 3.8.0 also kept a printed < or > only in the row's note. The note is the
// app's own sentence, so reading the sign back out of it is a plain fix too.

import { canonicalMarker } from "@/lib/lab-markers"
import { normalizeUnit } from "@/lib/lab-units"
import { labValueText, parseLabQualifier, type LabQualifier } from "@/lib/lab-flags"

export interface TidyRow {
  id: string
  marker: string
  unit: string
  value: number
  /** YYYY-MM-DD. */
  date: string
  notes?: string | null
  qualifier?: string | null
}

export interface TidyRename {
  id: string
  from: string
  to: string
  qualifier: LabQualifier | null
  value: number
  unit: string
  date: string
}

export interface TidyLimit {
  id: string
  marker: string
  qualifier: LabQualifier
  value: number
  unit: string
  date: string
}

export type TidyLookKind = "collision" | "urea-mg-dl" | "same-day"

export interface TidyLook {
  id: string
  marker: string
  qualifier: LabQualifier | null
  value: number
  unit: string
  date: string
  kind: TidyLookKind
  reason: string
}

export interface TidyPlan {
  /** Safe to apply: the name the row would get if it were saved today. */
  renames: TidyRename[]
  /** For a person to decide; never changed by the tidy. */
  needsALook: TidyLook[]
  /** A < or > that only the note recorded: the sign moves into its column. */
  limits: TidyLimit[]
}

const at = (marker: string, date: string) => `${marker}\u0000${date}`
const shown = (r: { value: number; unit: string; qualifier?: string | null }) =>
  `${labValueText(r.value, r.qualifier)} ${r.unit}`.trim()

/** The sign the 3.8.0 import card wrote into the note: "Printed as <5 (a limit, …". */
const LIMIT_NOTE = /^Printed as ([<>])(-?[\d.]+) \(a limit/

export function planLabTidy(rows: TidyRow[]): TidyPlan {
  const needsALook: TidyLook[] = []
  const candidates: TidyRename[] = []
  // Every row that keeps its name, by where it sits after the tidy.
  const staying = new Map<string, TidyRow[]>()

  for (const r of rows) {
    const to = canonicalMarker(r.marker).slice(0, 80)
    const qualifier = parseLabQualifier(r.qualifier)
    const maybeBun = to === "Urea" && normalizeUnit(r.unit) === "mg/dl"
    if (maybeBun) {
      needsALook.push({
        id: r.id, marker: r.marker, qualifier, value: r.value, unit: r.unit, date: r.date, kind: "urea-mg-dl",
        reason: `Filed as urea, but in mg/dL — the unit US reports give BUN (urea nitrogen) in, which reads about 2.14× lower than urea. If the report says BUN, this belongs in a BUN series.`,
      })
    }
    if (!to || to === r.marker || maybeBun) {
      const k = at(r.marker, r.date)
      staying.set(k, [...(staying.get(k) ?? []), r])
      continue
    }
    candidates.push({ id: r.id, from: r.marker, to, qualifier, value: r.value, unit: r.unit, date: r.date })
  }

  const incoming = new Map<string, TidyRename[]>()
  for (const c of candidates) {
    const k = at(c.to, c.date)
    incoming.set(k, [...(incoming.get(k) ?? []), c])
  }

  const renames: TidyRename[] = []
  for (const c of candidates) {
    const k = at(c.to, c.date)
    const there = [...(staying.get(k) ?? []), ...(incoming.get(k) ?? []).filter(o => o.id !== c.id)]
    if (there.length === 0) {
      renames.push(c)
      continue
    }
    needsALook.push({
      id: c.id, marker: c.from, qualifier: c.qualifier, value: c.value, unit: c.unit, date: c.date, kind: "collision",
      reason: `Would become ${c.to}, but ${c.date} would then hold ${there.length + 1} ${c.to} results (${[c, ...there].map(shown).join(", ")}). Keep the one that is ${c.to}, delete the rest, and tidy again.`,
    })
  }

  for (const group of staying.values()) {
    if (group.length < 2) continue
    for (const r of group) {
      needsALook.push({
        id: r.id, marker: r.marker, qualifier: parseLabQualifier(r.qualifier), value: r.value, unit: r.unit, date: r.date, kind: "same-day",
        reason: `${group.length} ${r.marker} results on ${r.date} (${group.map(shown).join(", ")}). One may be a related test saved under this name by an older version — HDL or LDL under Cholesterol, for instance. Check the report.`,
      })
    }
  }

  const limits: TidyLimit[] = []
  for (const r of rows) {
    if (parseLabQualifier(r.qualifier)) continue
    const m = LIMIT_NOTE.exec(r.notes ?? "")
    if (!m || Number(m[2]) !== r.value) continue
    limits.push({ id: r.id, marker: r.marker, qualifier: m[1] as LabQualifier, value: r.value, unit: r.unit, date: r.date })
  }

  return { renames, needsALook, limits }
}
