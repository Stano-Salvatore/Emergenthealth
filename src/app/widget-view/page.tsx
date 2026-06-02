import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"
export const revalidate = 0

async function getWidgetData(key: string) {
  const apiKey = await prisma.mcpApiKey.findUnique({ where: { token: key } }).catch(() => null)
  if (!apiKey) return null
  const userId = apiKey.userId

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString().split("T")[0]
  const yesterday = new Date(today.getTime() - 86400000)

  const [healthToday, healthYesterday, moodToday, habitsCompleted, habitsTotal, weather, checkin] = await Promise.all([
    prisma.healthLog.findFirst({
      where: { userId, date: { gte: today } },
      orderBy: { date: "desc" },
      select: { steps: true, readinessScore: true, hrv: true },
    }).catch(() => null),
    prisma.healthLog.findFirst({
      where: { userId, date: { gte: yesterday, lt: today } },
      orderBy: { date: "desc" },
      select: { sleepDuration: true, sleepScore: true },
    }).catch(() => null),
    prisma.moodLog.findFirst({
      where: { userId, date: { gte: today } },
      orderBy: { date: "desc" },
      select: { mood: true },
    }).catch(() => null),
    prisma.habitCompletion.count({ where: { userId, date: { gte: today } } }).catch(() => 0),
    prisma.habit.count({ where: { userId, isArchived: false } }).catch(() => 0),
    prisma.$queryRaw<{ tempMax: number; weatherCode: number }[]>`
      SELECT "tempMax","weatherCode" FROM "WeatherLog"
      WHERE "userId" = ${userId} AND date = ${todayStr} LIMIT 1
    `.catch(() => []),
    prisma.$queryRaw<{ energy: number; intention: string | null }[]>`
      SELECT energy, intention FROM "MorningCheckIn"
      WHERE "userId" = ${userId} AND date = ${todayStr} LIMIT 1
    `.catch(() => []),
  ])

  const w = (weather as { tempMax: number; weatherCode: number }[])[0] ?? null
  const c = (checkin as { energy: number; intention: string | null }[])[0] ?? null
  const sleepH = healthYesterday?.sleepDuration ? (healthYesterday.sleepDuration / 60).toFixed(1) : null

  function weatherEmoji(code: number) {
    if (code === 0) return "☀️"
    if (code <= 2) return "⛅"
    if (code <= 48) return "🌫️"
    if (code <= 67) return "🌧️"
    if (code <= 77) return "❄️"
    return "⛈️"
  }

  function moodEmoji(v: number | null) {
    if (!v) return null
    return ["😞", "😕", "😐", "🙂", "😄"][Math.min(4, Math.max(0, Math.round(v) - 1))]
  }

  const steps = healthToday?.steps ?? null
  const stepsGoal = 8000
  const stepsPct = steps ? Math.min(100, Math.round((steps / stepsGoal) * 100)) : 0
  const readiness = healthToday?.readinessScore ?? null
  const mood = moodToday?.mood ?? null

  function ringColor(val: number | null, thresholds: [number, number] = [50, 75]) {
    if (!val) return "#3f3f5a"
    if (val >= thresholds[1]) return "#22c55e"
    if (val >= thresholds[0]) return "#eab308"
    return "#ef4444"
  }

  return {
    steps, stepsGoal, stepsPct,
    sleepH,
    readiness, readinessColor: ringColor(readiness),
    mood, moodEmoji: moodEmoji(mood),
    habitsCompleted, habitsTotal,
    energy: c?.energy ?? null,
    intention: c?.intention ?? null,
    weather: w ? { temp: Math.round(w.tempMax), emoji: weatherEmoji(w.weatherCode) } : null,
    updatedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  }
}

export default async function WidgetViewPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>
}) {
  const { key } = await searchParams
  if (!key) notFound()

  const d = await getWidgetData(key)
  if (!d) notFound()

  const stepsBar = d.stepsPct
  const stepsColor = d.stepsPct >= 100 ? "#22c55e" : d.stepsPct >= 60 ? "#6366f1" : "#3f3f5a"

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
        <meta httpEquiv="refresh" content="600" />
        <title>Emergenthealth Widget</title>
        <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            background: #09090f;
            color: #f2f2fa;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            min-height: 100vh;
            padding: 16px;
          }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
          .card {
            background: #100f1a;
            border: 1px solid #1e1d2e;
            border-radius: 14px;
            padding: 14px;
          }
          .card.full { grid-column: 1 / -1; }
          .label {
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #7a7a96;
            margin-bottom: 6px;
          }
          .value { font-size: 26px; font-weight: 700; line-height: 1; }
          .unit { font-size: 13px; color: #7a7a96; margin-left: 2px; }
          .sub { font-size: 11px; color: #7a7a96; margin-top: 4px; }
          .bar-track {
            height: 5px;
            background: #1e1d2e;
            border-radius: 99px;
            margin-top: 8px;
            overflow: hidden;
          }
          .bar-fill {
            height: 100%;
            border-radius: 99px;
            transition: width 0.3s;
          }
          .dot {
            display: inline-block;
            width: 8px; height: 8px;
            border-radius: 50%;
            margin-right: 4px;
          }
          .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
          .intention {
            font-size: 12px;
            color: #a0a0c0;
            font-style: italic;
            line-height: 1.4;
          }
          .updated {
            text-align: right;
            font-size: 10px;
            color: #3f3f5a;
            margin-top: 10px;
          }
          .emoji { font-size: 22px; }
        `}</style>
      </head>
      <body>
        <div className="grid">

          {/* Steps */}
          <div className="card">
            <div className="label">Steps</div>
            <div className="value" style={{ color: stepsColor }}>
              {d.steps ? d.steps.toLocaleString() : "—"}
            </div>
            <div className="sub">Goal: {d.stepsGoal.toLocaleString()}</div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${stepsBar}%`, background: stepsColor }} />
            </div>
          </div>

          {/* Sleep */}
          <div className="card">
            <div className="label">Sleep</div>
            <div className="value" style={{ color: "#6366f1" }}>
              {d.sleepH ?? "—"}<span className="unit">h</span>
            </div>
            <div className="sub">Last night</div>
          </div>

          {/* Readiness */}
          <div className="card">
            <div className="label">Readiness</div>
            <div className="value" style={{ color: d.readinessColor }}>
              {d.readiness ?? "—"}
            </div>
            <div className="sub" style={{ color: d.readinessColor }}>
              {d.readiness ? (d.readiness >= 75 ? "Optimal" : d.readiness >= 50 ? "Good" : "Low") : "No data"}
            </div>
          </div>

          {/* Mood + Habits */}
          <div className="card">
            <div className="label">Mood · Habits</div>
            <div className="row" style={{ marginBottom: 6 }}>
              <span className="emoji">{d.moodEmoji ?? "—"}</span>
              <span className="value" style={{ fontSize: 20, color: "#ec4899" }}>
                {d.habitsCompleted}<span className="unit">/{d.habitsTotal}</span>
              </span>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{
                width: `${d.habitsTotal > 0 ? Math.round((d.habitsCompleted / d.habitsTotal) * 100) : 0}%`,
                background: "#ec4899"
              }} />
            </div>
          </div>

          {/* Intention / Weather */}
          {d.intention ? (
            <div className="card full">
              <div className="label">Today&apos;s intention</div>
              <div className="intention">&ldquo;{d.intention}&rdquo;</div>
            </div>
          ) : d.weather ? (
            <div className="card full">
              <div className="label">Weather</div>
              <div className="row">
                <span className="emoji">{d.weather.emoji}</span>
                <span className="value" style={{ fontSize: 20 }}>{d.weather.temp}°C</span>
              </div>
            </div>
          ) : null}

        </div>
        <div className="updated">Updated {d.updatedAt}</div>
      </body>
    </html>
  )
}
