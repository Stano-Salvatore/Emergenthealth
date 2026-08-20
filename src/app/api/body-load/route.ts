import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getGoals } from "@/lib/goals"
import { classifyOuraTag } from "@/lib/oura-tag-classify"
import { normalizeSupplement, cleanLabel } from "@/lib/supplement-normalize"
import { supplementInfoFor } from "@/lib/supplement-info"
import { formatDose } from "@/lib/dose"
import { getPersonalCaffeineProfile } from "@/lib/caffeine-profile"
import { COMPOUND_LABELS } from "@/lib/caffeine"
import {
  ethanolGrams, alcoholClearanceGPerHour, alcoholRemainingG, standardDrinks,
  hoursUntilBelow, decayFraction, MED_FLOOR_FRACTION, CAFFEINE_FLOOR_MG,
  type ActiveSubstance,
} from "@/lib/body-load"

// Everything currently circulating, in one list. Each source is queried over
// the window it can plausibly still matter in: caffeine and alcohol 24 h, meds
// 72 h (Elicea's ~30 h half-life is still a third present after two days).

const ALCOHOL_TYPES = new Set(["beer", "wine", "spirits", "alcohol"])

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const now = new Date()
  const since24 = new Date(now.getTime() - 24 * 3_600_000)
  const since72 = new Date(now.getTime() - 72 * 3_600_000)

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

    prisma.$queryRaw<{ id: string; tagName: string | null; text: string | null; timestamp: Date; doseAmount: number | null; doseUnit: string | null }[]>`
      SELECT "id", "tagName", "text", "timestamp", "doseAmount", "doseUnit" FROM "OuraTag"
      WHERE "userId" = ${userId} AND "timestamp" >= ${since72}
      ORDER BY "timestamp" ASC
    `.catch(() => [] as { id: string; tagName: string | null; text: string | null; timestamp: Date; doseAmount: number | null; doseUnit: string | null }[]),

    getPersonalCaffeineProfile(userId),

    // Weight and sex are goals (see @/lib/goals).
    getGoals(userId),

    prisma.healthLog.findFirst({
      where: { userId, weight: { not: null } },
      orderBy: { date: "desc" },
      select: { weight: true },
    }).catch(() => null),
  ])

  const substances: ActiveSubstance[] = []

  // ── Caffeine (first-order, at the user's own half-life) ──
  const halfLifeH = profile.halfLifeH
  let caffeineMg = 0
  let lastCaffeineAt: Date | null = null
  const compounds = new Set<string>()
  for (const d of caffeineDoses) {
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
      detail: `${[...compounds].slice(0, 3).join(", ")} · half-life ${halfLifeH}h${profile.usedDefault ? " (standard)" : " (yours)"}`,
    })
  }

  // ── Alcohol (zero-order — a flat rate, and a real finishing time) ──
  const sex = goals.sex
  const weightKg = weightRow?.weight ?? goals.weightKg
  const clearance = alcoholClearanceGPerHour(weightKg, sex)

  const alcoholDoses = drinks
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
    })
  }

  // ── Meds and supplements with a known half-life ──
  for (const t of medTags) {
    const label = ((t.tagName ?? t.text) ?? "").trim()
    if (!label || classifyOuraTag(label).kind !== "med") continue
    const info = supplementInfoFor(label)
    if (!info?.halfLifeH) continue // stored substances have no meaningful "still active"
    const hours = (now.getTime() - t.timestamp.getTime()) / 3_600_000
    const fraction = decayFraction(hours, info.halfLifeH)
    if (fraction < MED_FLOOR_FRACTION) continue

    const name = normalizeSupplement(label) ?? cleanLabel(label)
    const hoursLeft = hoursUntilBelow(fraction, MED_FLOOR_FRACTION, info.halfLifeH) ?? 0
    const existing = substances.find(s => s.kind === "med" && s.name === name)
    // Multiple doses of the same thing: show the most recent one
    if (existing && new Date(existing.takenAt) >= t.timestamp) continue
    const entry: ActiveSubstance = {
      kind: "med",
      name,
      emoji: "💊",
      amount: Math.round(fraction * 100),
      unit: "%",
      fraction,
      takenAt: t.timestamp.toISOString(),
      clearsAt: new Date(now.getTime() + hoursLeft * 3_600_000).toISOString(),
      detail: `half-life ${info.halfLifeH}h${info.caution ? "" : ""}`,
      // Only manual entries: an Oura tag deleted here returns on the next sync.
      sourceId: t.id.startsWith("manual_") ? t.id : undefined,
      doseLabel: formatDose(t.doseAmount, t.doseUnit),
    }
    if (existing) substances.splice(substances.indexOf(existing), 1, entry)
    else substances.push(entry)
  }

  // Most recently taken first — that's what the user is asking about
  substances.sort((a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime())

  return NextResponse.json({
    now: now.toISOString(),
    substances,
    caffeineHalfLifeH: halfLifeH,
    personalHalfLife: !profile.usedDefault,
  })
}
