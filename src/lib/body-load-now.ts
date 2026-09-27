// Everything currently circulating, in one list — the "In my body" tab and the
// chat's scripted "what's still in me" answer both read this, so the two can
// never give different numbers for the same morning. Each source is queried
// over the window it can plausibly still matter in: caffeine and alcohol 24 h,
// meds a week, past the ~130 h a dose of Elicea (~30 h half-life) takes to
// fall under the floor. 72 h dropped it from the tab three days into a taper,
// with a clinically relevant level still there.

import { prisma } from "@/lib/prisma"
import { getGoals } from "@/lib/goals"
import { classifyOuraTag } from "@/lib/oura-tag-classify"
import { normalizeSupplement, cleanLabel } from "@/lib/supplement-normalize"
import { supplementInfoFor } from "@/lib/supplement-info"
import { formatDose } from "@/lib/dose"
import { getPersonalCaffeineProfile } from "@/lib/caffeine-profile"
import { COMPOUND_LABELS } from "@/lib/caffeine"
import {
  ALCOHOL_TYPES,
  ethanolGrams, alcoholClearanceGPerHour, alcoholRemainingG, standardDrinks,
  permilleFromGrams, widmarkDistributionKg,
  hoursUntilBelow, decayFraction, stackedDoses, MED_FLOOR_FRACTION, CAFFEINE_FLOOR_MG,
  type ActiveSubstance,
} from "@/lib/body-load"
import { latestWeightKg } from "@/lib/weight-series"

/**
 * A dose logged recently that the app has no pharmacology for at all. It may
 * well still be working; the app just cannot draw its curve, and leaving it
 * out made the tab say "Clear right now" an hour after a sleeping pill.
 */
export interface UnmodeledDose {
  name: string
  takenAt: string // ISO
  sourceId?: string
}

export interface BodyLoadNow {
  now: string
  substances: ActiveSubstance[]
  unmodeled: UnmodeledDose[]
  caffeineHalfLifeH: number
  personalHalfLife: boolean
}

export interface BodyLoadInputs {
  caffeineDoses: { caffeineMg: number; loggedAt: Date; compound: string }[]
  drinks: { type: string; amountMl: number; note: string | null; loggedAt: Date }[]
  medTags: { id: string; tagName: string | null; text: string | null; timestamp: Date; doseAmount: number | null; doseUnit: string | null }[]
  halfLifeH: number
  personalHalfLife: boolean
  weightKg: number | null | undefined
  sex: string | null | undefined
}

export function bodyLoadFrom(inp: BodyLoadInputs, now: Date): BodyLoadNow {
  const substances: ActiveSubstance[] = []

  // ── Caffeine (first-order, at the user's own half-life) ──
  const { halfLifeH } = inp
  let caffeineMg = 0
  let lastCaffeineAt: Date | null = null
  const compounds = new Set<string>()
  for (const d of inp.caffeineDoses) {
    const hours = (now.getTime() - d.loggedAt.getTime()) / 3_600_000
    const left = d.caffeineMg * decayFraction(hours, halfLifeH)
    if (left >= 1) {
      caffeineMg += left
      compounds.add(COMPOUND_LABELS[d.compound]?.label ?? d.compound)
      if (!lastCaffeineAt || d.loggedAt > lastCaffeineAt) lastCaffeineAt = d.loggedAt
    }
  }
  if (caffeineMg >= CAFFEINE_FLOOR_MG && lastCaffeineAt) {
    const hoursLeft = hoursUntilBelow(caffeineMg, CAFFEINE_FLOOR_MG, halfLifeH) ?? 0
    substances.push({
      kind: "caffeine",
      name: "Caffeine",
      emoji: "☕",
      amount: Math.round(caffeineMg),
      unit: "mg",
      takenAt: lastCaffeineAt.toISOString(),
      clearsAt: new Date(now.getTime() + hoursLeft * 3_600_000).toISOString(),
      detail: `${[...compounds].slice(0, 3).join(", ")} · half-life ${halfLifeH}h${inp.personalHalfLife ? " (yours)" : " (standard)"}`,
    })
  }

  // ── Alcohol (zero-order — a flat rate, and a real finishing time) ──
  const { sex, weightKg } = inp
  const clearance = alcoholClearanceGPerHour(weightKg, sex)

  const alcoholDoses = inp.drinks
    .map(d => ({ grams: ethanolGrams(d.type, d.amountMl, d.note ?? undefined), at: d.loggedAt }))
    .filter(d => d.grams > 0)
  const alcohol = alcoholRemainingG(alcoholDoses, now, clearance)
  if (alcohol.remainingG >= 1) {
    substances.push({
      kind: "alcohol",
      name: "Alcohol",
      emoji: "🍷",
      amount: standardDrinks(alcohol.remainingG),
      unit: "g",
      takenAt: (alcoholDoses[alcoholDoses.length - 1]?.at ?? now).toISOString(),
      clearsAt: alcohol.clearsAt?.toISOString() ?? null,
      detail: `≈${Math.round(alcohol.remainingG)} g ethanol left · clearing ≈${clearance.toFixed(1)} g/h`,
      // The same two numbers the detail string already spells out, sent as
      // numbers so the curve card does not have to read them back out of
      // prose. A chart parsing its own label is one rewording from breaking.
      gramsLeft: Math.round(alcohol.remainingG * 10) / 10,
      clearanceGPerH: Math.round(clearance * 10) / 10,
      permille: permilleFromGrams(alcohol.remainingG, weightKg, sex),
      distributionKg: Math.round(widmarkDistributionKg(weightKg, sex) * 10) / 10,
    })
  }

  // ── Meds and supplements with a known half-life ──
  const unmodeled = new Map<string, UnmodeledDose>()
  // Every dose of the same thing, summed: a daily medicine is the sum of the
  // week's tablets still decaying, not the last one alone.
  const medDoses = new Map<string, { halfLifeH: number; doses: BodyLoadInputs["medTags"] }>()
  for (const t of inp.medTags) {
    const label = ((t.tagName ?? t.text) ?? "").trim()
    if (!label || classifyOuraTag(label).kind !== "med") continue
    const name = normalizeSupplement(label) ?? cleanLabel(label)
    // Only the doses the app knows nothing about. A stored supplement
    // (vitamin D, B12) has an entry and deliberately no half-life — its effect
    // is weeks of consistency, not hours on board.
    const info = supplementInfoFor(label)
    if (!info) {
      const prev = unmodeled.get(name.toLowerCase())
      if (!prev || new Date(prev.takenAt) < t.timestamp) {
        unmodeled.set(name.toLowerCase(), {
          name,
          takenAt: t.timestamp.toISOString(),
          sourceId: t.id.startsWith("manual_") ? t.id : undefined,
        })
      }
      continue
    }
    if (!info.halfLifeH) continue
    const group = medDoses.get(name) ?? { halfLifeH: info.halfLifeH, doses: [] }
    group.doses.push(t)
    medDoses.set(name, group)
  }
  for (const [name, { halfLifeH: medHalfLifeH, doses }] of medDoses) {
    const total = stackedDoses(doses.map(d => d.timestamp), now, medHalfLifeH)
    if (total < MED_FLOOR_FRACTION) continue
    const latest = doses[doses.length - 1]
    const hoursLeft = hoursUntilBelow(total, MED_FLOOR_FRACTION, medHalfLifeH) ?? 0
    const counted = doses.filter(d => decayFraction((now.getTime() - d.timestamp.getTime()) / 3_600_000, medHalfLifeH) >= 0.01).length
    substances.push({
      kind: "med",
      name,
      emoji: "💊",
      amount: Math.round(total * 100),
      unit: "%",
      fraction: total,
      takenAt: latest.timestamp.toISOString(),
      clearsAt: new Date(now.getTime() + hoursLeft * 3_600_000).toISOString(),
      detail: `half-life ${medHalfLifeH}h${counted > 1 ? ` · ${counted} doses still adding up` : ""}`,
      // Only manual entries: an Oura tag deleted here returns on the next sync.
      sourceId: latest.id.startsWith("manual_") ? latest.id : undefined,
      doseLabel: formatDose(latest.doseAmount, latest.doseUnit),
    })
  }

  // Most recently taken first — that's what the user is asking about
  substances.sort((a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime())
  const unknown = [...unmodeled.values()].sort((a, b) => b.takenAt.localeCompare(a.takenAt))

  return {
    now: now.toISOString(),
    substances,
    unmodeled: unknown,
    caffeineHalfLifeH: halfLifeH,
    personalHalfLife: inp.personalHalfLife,
  }
}

export async function computeBodyLoad(userId: string, now = new Date()): Promise<BodyLoadNow> {
  const since24 = new Date(now.getTime() - 24 * 3_600_000)
  const sinceMeds = new Date(now.getTime() - 168 * 3_600_000)

  const [caffeineDoses, drinks, medTags, profile, goals, weightRow] = await Promise.all([
    prisma.caffeineLog.findMany({
      where: { userId, loggedAt: { gte: since24 } },
      select: { caffeineMg: true, loggedAt: true, compound: true },
      orderBy: { loggedAt: "asc" },
    }).catch(() => [] as { caffeineMg: number; loggedAt: Date; compound: string }[]),

    prisma.intakeLog.findMany({
      where: { userId, type: { in: [...ALCOHOL_TYPES] }, loggedAt: { gte: since24 } },
      select: { type: true, amountMl: true, note: true, loggedAt: true },
      orderBy: { loggedAt: "asc" },
    }).catch(() => [] as { type: string; amountMl: number; note: string | null; loggedAt: Date }[]),

    prisma.$queryRaw<BodyLoadInputs["medTags"]>`
      SELECT "id", "tagName", "text", "timestamp", "doseAmount", "doseUnit" FROM "OuraTag"
      WHERE "userId" = ${userId} AND "timestamp" >= ${sinceMeds}
      ORDER BY "timestamp" ASC
    `.catch(() => [] as BodyLoadInputs["medTags"]),

    getPersonalCaffeineProfile(userId),

    // Weight and sex are goals (see @/lib/goals).
    getGoals(userId),

    // The most recent weigh-in from either table (lib/weight-series).
    latestWeightKg(userId).catch(() => null),
  ])

  return bodyLoadFrom({
    caffeineDoses, drinks, medTags,
    halfLifeH: profile.halfLifeH,
    personalHalfLife: !profile.usedDefault,
    weightKg: weightRow ?? goals.weightKg,
    sex: goals.sex,
  }, now)
}
