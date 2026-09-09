import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getGoals, saveGoals } from "@/lib/goals"
import { loadWeightSeries, latestWeightKg } from "@/lib/weight-series"
import { weightGoalProgress, weightTrend } from "@/lib/weight-trend"
import { computeTargets } from "@/lib/targets"

// Everything the weight-goal card needs in one call: the goal as stored, the
// merged weight series with its trend, where the goal stands, and the calorie
// and protein targets the goal implies. POST sets or clears the goal through
// the same goals store the settings page uses.

async function payload(userId: string) {
  const [goals, series] = await Promise.all([getGoals(userId), loadWeightSeries(userId, 120)])
  const trend = weightTrend(series)
  const latest = series.length ? series[series.length - 1].kg : goals.weightKg
  const progress = goals.weightGoalMode
    ? weightGoalProgress(series, {
        mode: goals.weightGoalMode,
        targetKg: goals.weightTargetKg,
        paceKgWk: goals.weightPaceKgWk,
        startKg: goals.weightGoalStartKg,
      })
    : null
  const targets = computeTargets({
    weightKg: latest, heightCm: goals.heightCm, birthYear: goals.birthYear, sex: goals.sex,
    weightGoal: goals.weightGoalMode ? { mode: goals.weightGoalMode, paceKgWk: goals.weightPaceKgWk } : null,
  })
  return {
    goal: {
      mode: goals.weightGoalMode,
      targetKg: goals.weightTargetKg,
      paceKgWk: goals.weightPaceKgWk,
      startKg: goals.weightGoalStartKg,
      startedAt: goals.weightGoalStartedAt,
    },
    heightCm: goals.heightCm,
    latestKg: latest,
    series: trend.slice(-90),
    progress,
    targets,
  }
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json(await payload(session.user.id))
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if ("mode" in body) patch.weightGoalMode = body.mode
  if ("targetKg" in body) patch.weightTargetKg = body.targetKg
  if ("paceKgWk" in body) patch.weightPaceKgWk = body.paceKgWk
  if ("weightKg" in body) patch.weightKg = body.weightKg

  const nowKg = await latestWeightKg(session.user.id)
  await saveGoals(session.user.id, patch, nowKg)
  return NextResponse.json(await payload(session.user.id))
}
