"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

interface HabitStreak {
  id: string
  name: string
  color: string
  icon: string | null
  currentStreak: number
  longestStreak: number
  totalCompletions: number
}

interface Achievement {
  id: string
  emoji: string
  title: string
  desc: string
  unlocked: boolean
  progress: number
  target: number
}

interface StreaksData {
  xp: {
    total: number
    byCategory: {
      habits: number; sleep: number; weight: number; mood: number
      journal: number; intake: number; focus: number; reading: number; supplements: number
    }
  }
  level: number
  progress: number
  xpToNext: number
  xpInLevel: number
  habitStreaks: HabitStreak[]
  achievements: Achievement[]
}

const XP_COLORS: Record<string, string> = {
  habits:      "bg-violet-500",
  sleep:       "bg-blue-500",
  weight:      "bg-emerald-500",
  mood:        "bg-yellow-500",
  journal:     "bg-orange-500",
  intake:      "bg-cyan-500",
  focus:       "bg-red-500",
  reading:     "bg-pink-500",
  supplements: "bg-green-500",
}

const XP_LABELS: Record<string, string> = {
  habits: "Habits", sleep: "Sleep", weight: "Weight", mood: "Mood",
  journal: "Journal", intake: "Intake", focus: "Focus", reading: "Reading",
  supplements: "Supplements",
}

function LevelBadge({ level }: { level: number }) {
  const colors = ["", "from-slate-400 to-slate-600", "from-green-400 to-green-600", "from-blue-400 to-blue-600",
    "from-violet-400 to-violet-600", "from-amber-400 to-amber-600", "from-orange-400 to-orange-600",
    "from-red-400 to-red-600", "from-pink-400 to-pink-600", "from-indigo-400 to-indigo-600", "from-yellow-400 to-yellow-600"]
  const c = colors[Math.min(level, colors.length - 1)] ?? "from-indigo-400 to-indigo-600"
  return (
    <div className={cn("inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br text-white font-black text-xl shadow-lg", c)}>
      {level}
    </div>
  )
}

function FireStreak({ n, size = "md" }: { n: number; size?: "sm" | "md" | "lg" }) {
  if (n === 0) return <span className={cn("text-muted-foreground", size === "sm" ? "text-xs" : "text-sm")}>—</span>
  const cls = size === "lg" ? "text-2xl font-black" : size === "md" ? "text-lg font-bold" : "text-sm font-semibold"
  const flame = n >= 30 ? "🔥🔥" : n >= 7 ? "🔥" : "🌱"
  return <span className={cls}>{flame} {n}d</span>
}

export default function StreaksPage() {
  const [data, setData] = useState<StreaksData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/streaks")
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading…</div>
  )
  if (!data) return null

  const { xp, level, progress, xpToNext, habitStreaks, achievements } = data
  const total = xp.total
  const cats = Object.entries(xp.byCategory).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])

  const unlocked = achievements.filter(a => a.unlocked)
  const locked = achievements.filter(a => !a.unlocked).sort((a, b) => (b.progress / b.target) - (a.progress / a.target))

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Streaks & Achievements</h1>
        <p className="text-muted-foreground text-sm mt-1">Your health journey progress</p>
      </div>

      {/* Level card */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-5">
          <LevelBadge level={level} />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between mb-2">
              <span className="font-bold text-lg">Level {level}</span>
              <span className="text-sm text-muted-foreground">{total.toLocaleString()} XP total</span>
            </div>
            <div className="h-3 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">{xpToNext.toLocaleString()} XP to level {level + 1}</p>
          </div>
        </div>

        {/* XP breakdown */}
        {cats.length > 0 && (
          <div className="mt-5 pt-4 border-t border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">XP by category</p>
            <div className="flex h-4 rounded-full overflow-hidden gap-px">
              {cats.map(([key, val]) => (
                <div
                  key={key}
                  className={cn("transition-all", XP_COLORS[key] ?? "bg-primary")}
                  style={{ width: `${(val / total) * 100}%` }}
                  title={`${XP_LABELS[key]}: ${val} XP`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
              {cats.map(([key, val]) => (
                <div key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn("inline-block w-2 h-2 rounded-full", XP_COLORS[key] ?? "bg-primary")} />
                  {XP_LABELS[key]} <span className="text-foreground font-medium">{val}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Habit streaks */}
      {habitStreaks.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-3">Habit Streaks</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {habitStreaks.sort((a, b) => b.currentStreak - a.currentStreak).map(h => (
              <div key={h.id} className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                  style={{ backgroundColor: h.color + "22", border: `2px solid ${h.color}44` }}
                >
                  {h.icon ?? "✅"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{h.name}</p>
                  <p className="text-xs text-muted-foreground">{h.totalCompletions} completions</p>
                </div>
                <div className="text-right shrink-0">
                  <FireStreak n={h.currentStreak} size="md" />
                  {h.longestStreak > h.currentStreak && (
                    <p className="text-xs text-muted-foreground mt-0.5">best {h.longestStreak}d</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Achievements unlocked */}
      {unlocked.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-3">🏆 Earned ({unlocked.length})</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {unlocked.map(a => (
              <div key={a.id} className="rounded-xl border border-primary/30 bg-primary/5 p-3.5 text-center">
                <div className="text-3xl mb-1.5">{a.emoji}</div>
                <p className="text-sm font-semibold leading-tight">{a.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Achievements locked */}
      {locked.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-3 text-muted-foreground">🔒 Locked ({locked.length})</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {locked.map(a => (
              <div key={a.id} className="rounded-xl border border-border bg-card/50 p-3.5 text-center opacity-60">
                <div className="text-3xl mb-1.5 grayscale">{a.emoji}</div>
                <p className="text-sm font-semibold leading-tight">{a.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">{a.desc}</p>
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary/50"
                    style={{ width: `${Math.round((a.progress / a.target) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{a.progress}/{a.target}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
