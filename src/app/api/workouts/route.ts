import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logWorkout, deleteWorkout, loadSessionsForUser, WORKOUT_TYPES, type LogWorkoutInput } from "@/lib/workouts"
import { trainingLoad, suggestSession } from "@/lib/training-load"
import { userToday } from "@/lib/user-timezone"

// Training sessions logged by hand, plus the load and readiness read that
// goes with them. The rows themselves come back through /api/strava/activities
// alongside synced ones — this route is for writing and for the summary.

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const today = await userToday(userId)
  const since = new Date(Date.parse(today + "T00:00:00Z") - 30 * 86_400_000)
  const [sessions, readinessRows] = await Promise.all([
    loadSessionsForUser(userId, today),
    prisma.healthLog.findMany({
      where: { userId, date: { gte: since }, readinessScore: { not: null } },
      orderBy: { date: "desc" },
      select: { date: true, readinessScore: true },
    }).catch(() => [] as { date: Date; readinessScore: number | null }[]),
  ])

  const load = trainingLoad(sessions, today)
  const todayRow = readinessRows.find(r => r.date.toISOString().slice(0, 10) === today)
  const recent = readinessRows.filter(r => r !== todayRow).map(r => r.readinessScore!).filter(n => n != null)
  const suggestion = suggestSession(todayRow?.readinessScore ?? null, recent, load)

  return NextResponse.json({
    today,
    load,
    readiness: todayRow?.readinessScore ?? null,
    suggestion,
    types: WORKOUT_TYPES,
  })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const result = await logWorkout(session.user.id, body as LogWorkoutInput)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result, { status: 201 })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const id = new URL(req.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
  const removed = await deleteWorkout(session.user.id, id)
  if (!removed) return NextResponse.json({ error: "Not found or not a manual session" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
