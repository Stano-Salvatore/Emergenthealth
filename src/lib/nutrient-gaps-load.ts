// Pull the food log together with the lab results, so a shortfall can be told
// apart from a measured one.
//
// "Your logged magnesium has run at a third of the reference value for a
// fortnight" is a statement about your logging. "…and your last blood panel
// never measured it" is the sentence that's actually worth taking to a doctor,
// and "…and your ferritin came back mid-range in March" is the one that says
// don't worry about it. Neither source is worth much alone.

import { prisma } from "@/lib/prisma"
import {
  assessCoverage, nutrientGaps, LAB_MARKER_FOR,
  type CoverageVerdict, type DayCalories, type LoggedMicro, type NutrientGap,
} from "@/lib/nutrients"

export const WINDOW_DAYS = 14

export interface LabCheck {
  marker: string
  value: number
  unit: string
  date: string
  status: "in-range" | "below" | "above" | "unknown"
}

export interface GapWithLab extends NutrientGap {
  /** The most recent measurement of this nutrient, if one was ever taken. */
  lab: LabCheck | null
}

export interface NutrientReport {
  coverage: CoverageVerdict
  gaps: GapWithLab[]
  windowDays: number
}

interface MicroRow { name?: unknown; amount?: unknown; unit?: unknown }

function dayOf(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function loadNutrientReport(userId: string): Promise<NutrientReport> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000)

  const meals = await prisma.foodLog.findMany({
    where: { userId, loggedAt: { gte: since } },
    select: { loggedAt: true, calories: true, micros: true },
  }).catch(() => [] as { loggedAt: Date; calories: number; micros: unknown }[])

  // Calories per day, for the coverage gates
  const kcalByDay = new Map<string, number>()
  const micros: LoggedMicro[] = []
  for (const m of meals) {
    const day = dayOf(m.loggedAt)
    kcalByDay.set(day, (kcalByDay.get(day) ?? 0) + (m.calories ?? 0))
    if (!Array.isArray(m.micros)) continue
    for (const raw of m.micros as MicroRow[]) {
      const name = typeof raw?.name === "string" ? raw.name : null
      const amount = Number(raw?.amount)
      const unit = typeof raw?.unit === "string" ? raw.unit : null
      if (!name || !unit || !Number.isFinite(amount)) continue
      micros.push({ day, name, amount, unit })
    }
  }

  const dayCalories: DayCalories[] = Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const day = dayOf(new Date(Date.now() - i * 86400000))
    return { day, calories: kcalByDay.get(day) ?? 0 }
  })

  const coverage = assessCoverage(dayCalories, WINDOW_DAYS)
  // Below the coverage bar the gaps would be artefacts of missed meals, so
  // they aren't computed at all rather than computed and hidden — there's
  // nothing to reveal with a "show anyway" toggle here, only noise.
  if (!coverage.ok) return { coverage, gaps: [], windowDays: WINDOW_DAYS }

  const gaps = nutrientGaps(micros, WINDOW_DAYS)
  if (gaps.length === 0) return { coverage, gaps: [], windowDays: WINDOW_DAYS }

  // Most recent lab reading for any marker that measures one of these
  const wanted = gaps.map(g => LAB_MARKER_FOR[g.nutrient]).filter(Boolean) as string[]
  const labs = wanted.length > 0
    ? await prisma.labResult.findMany({
        where: { userId, marker: { in: wanted } },
        orderBy: { date: "desc" },
        select: { marker: true, value: true, unit: true, date: true, referenceMin: true, referenceMax: true },
      }).catch(() => [])
    : []

  const latestByMarker = new Map<string, (typeof labs)[number]>()
  for (const l of labs) if (!latestByMarker.has(l.marker)) latestByMarker.set(l.marker, l)

  return {
    coverage,
    windowDays: WINDOW_DAYS,
    gaps: gaps.map(g => {
      const marker = LAB_MARKER_FOR[g.nutrient]
      const l = marker ? latestByMarker.get(marker) : undefined
      if (!l) return { ...g, lab: null }
      const status: LabCheck["status"] =
        l.referenceMin == null && l.referenceMax == null ? "unknown"
          : l.referenceMin != null && l.value < l.referenceMin ? "below"
            : l.referenceMax != null && l.value > l.referenceMax ? "above"
              : "in-range"
      return {
        ...g,
        lab: {
          marker: l.marker,
          value: l.value,
          unit: l.unit,
          date: typeof l.date === "string" ? l.date : dayOf(l.date as unknown as Date),
          status,
        },
      }
    }),
  }
}
