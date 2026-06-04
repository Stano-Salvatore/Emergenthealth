import { ImageResponse } from "next/og"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

async function getWidgetData(key: string) {
  const apiKey = await prisma.mcpApiKey.findUnique({ where: { token: key } }).catch(() => null)
  if (!apiKey) return null
  const userId = apiKey.userId

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString().split("T")[0]
  const yesterday = new Date(today.getTime() - 86400000)

  const [healthToday, healthYesterday, moodToday, habitsCompleted, habitsTotal, checkin] = await Promise.all([
    prisma.healthLog.findFirst({
      where: { userId, date: { gte: today } },
      orderBy: { date: "desc" },
      select: { steps: true, readinessScore: true },
    }).catch(() => null),
    prisma.healthLog.findFirst({
      where: { userId, date: { gte: yesterday, lt: today } },
      orderBy: { date: "desc" },
      select: { sleepDuration: true },
    }).catch(() => null),
    prisma.moodLog.findFirst({
      where: { userId, date: { gte: today } },
      orderBy: { date: "desc" },
      select: { mood: true },
    }).catch(() => null),
    prisma.habitCompletion.count({ where: { userId, date: { gte: today } } }).catch(() => 0),
    prisma.habit.count({ where: { userId, isArchived: false } }).catch(() => 0),
    prisma.$queryRaw<{ intention: string | null }[]>`
      SELECT intention FROM "MorningCheckIn"
      WHERE "userId" = ${userId} AND date = ${todayStr} LIMIT 1
    `.catch(() => []),
  ])

  const c = (checkin as { intention: string | null }[])[0] ?? null
  const steps = healthToday?.steps ?? null
  const sleepH = healthYesterday?.sleepDuration ? (healthYesterday.sleepDuration / 60).toFixed(1) : null
  const readiness = healthToday?.readinessScore ?? null
  const mood = moodToday?.mood ?? null

  function moodEmoji(v: number | null) {
    if (!v) return "—"
    return ["😞", "😕", "😐", "🙂", "😄"][Math.min(4, Math.max(0, Math.round(v) - 1))]
  }

  function readinessColor(v: number | null) {
    if (!v) return "#3f3f5a"
    if (v >= 75) return "#22c55e"
    if (v >= 50) return "#eab308"
    return "#ef4444"
  }

  return {
    steps,
    stepsPct: steps ? Math.min(100, Math.round((steps / 8000) * 100)) : 0,
    sleepH,
    readiness,
    readinessColor: readinessColor(readiness),
    mood: moodEmoji(mood),
    habitsCompleted,
    habitsTotal,
    habitsPct: habitsTotal > 0 ? Math.round((habitsCompleted / habitsTotal) * 100) : 0,
    intention: c?.intention ?? null,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  }
}

export async function GET(req: NextRequest) {
  const key = new URL(req.url).searchParams.get("key")
  if (!key) return new Response("Missing key", { status: 400 })

  const d = await getWidgetData(key)
  if (!d) return new Response("Unauthorized", { status: 401 })

  const stepsColor = d.stepsPct >= 100 ? "#22c55e" : d.stepsPct >= 60 ? "#6366f1" : "#7a7a96"

  return new ImageResponse(
    (
      <div
        style={{
          width: "800px",
          height: "400px",
          background: "#09090f",
          display: "flex",
          flexDirection: "column",
          padding: "28px",
          gap: "16px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Top row */}
        <div style={{ display: "flex", gap: "16px", flex: 1 }}>
          {/* Steps */}
          <div style={{
            flex: 1, background: "#100f1a", borderRadius: "16px", padding: "18px",
            display: "flex", flexDirection: "column", justifyContent: "space-between",
          }}>
            <div style={{ fontSize: "11px", color: "#7a7a96", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>Steps</div>
            <div style={{ fontSize: "32px", fontWeight: 700, color: stepsColor }}>
              {d.steps ? d.steps.toLocaleString() : "—"}
            </div>
            {/* Progress bar */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <div style={{ fontSize: "10px", color: "#7a7a96" }}>Goal: 8,000</div>
              <div style={{ height: "5px", background: "#1e1d2e", borderRadius: "99px", width: "100%", display: "flex" }}>
                <div style={{ height: "5px", background: stepsColor, borderRadius: "99px", width: `${d.stepsPct}%` }} />
              </div>
            </div>
          </div>

          {/* Sleep */}
          <div style={{
            flex: 1, background: "#100f1a", borderRadius: "16px", padding: "18px",
            display: "flex", flexDirection: "column", justifyContent: "space-between",
          }}>
            <div style={{ fontSize: "11px", color: "#7a7a96", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>Sleep</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
              <span style={{ fontSize: "32px", fontWeight: 700, color: "#6366f1" }}>{d.sleepH ?? "—"}</span>
              {d.sleepH && <span style={{ fontSize: "14px", color: "#7a7a96" }}>h</span>}
            </div>
            <div style={{ fontSize: "10px", color: "#7a7a96" }}>Last night</div>
          </div>

          {/* Readiness */}
          <div style={{
            flex: 1, background: "#100f1a", borderRadius: "16px", padding: "18px",
            display: "flex", flexDirection: "column", justifyContent: "space-between",
          }}>
            <div style={{ fontSize: "11px", color: "#7a7a96", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>Readiness</div>
            <div style={{ fontSize: "32px", fontWeight: 700, color: d.readinessColor }}>{d.readiness ?? "—"}</div>
            <div style={{ fontSize: "10px", color: d.readinessColor }}>
              {d.readiness ? (d.readiness >= 75 ? "Optimal" : d.readiness >= 50 ? "Good" : "Low") : "No data"}
            </div>
          </div>

          {/* Mood + Habits */}
          <div style={{
            flex: 1, background: "#100f1a", borderRadius: "16px", padding: "18px",
            display: "flex", flexDirection: "column", justifyContent: "space-between",
          }}>
            <div style={{ fontSize: "11px", color: "#7a7a96", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>Mood · Habits</div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "26px" }}>{d.mood}</span>
              <span style={{ fontSize: "24px", fontWeight: 700, color: "#ec4899" }}>
                {d.habitsCompleted}<span style={{ fontSize: "13px", color: "#7a7a96" }}>/{d.habitsTotal}</span>
              </span>
            </div>
            <div style={{ height: "5px", background: "#1e1d2e", borderRadius: "99px", width: "100%", display: "flex" }}>
              <div style={{ height: "5px", background: "#ec4899", borderRadius: "99px", width: `${d.habitsPct}%` }} />
            </div>
          </div>
        </div>

        {/* Intention / footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {d.intention ? (
            <div style={{ fontSize: "12px", color: "#a0a0c0", fontStyle: "italic" }}>
              "{d.intention.slice(0, 80)}{d.intention.length > 80 ? "…" : ""}"
            </div>
          ) : (
            <div />
          )}
          <div style={{ fontSize: "10px", color: "#3f3f5a" }}>{d.time}</div>
        </div>
      </div>
    ),
    { width: 800, height: 400 }
  )
}
