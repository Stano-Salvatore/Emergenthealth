"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Smile } from "lucide-react"
import { format, subDays } from "date-fns"

interface MoodEntry {
  date: string
  mood: number
  energy: number | null
  sleepH: number | null
}

interface MoodHistoryResponse {
  logs: MoodEntry[]
}

// Mood scale: 1=red, 2=orange, 3=yellow, 4=lime, 5=green
const MOOD_BAR_COLORS: Record<number, string> = {
  1: "bg-red-500",
  2: "bg-orange-500",
  3: "bg-yellow-400",
  4: "bg-lime-500",
  5: "bg-green-500",
}

const MOOD_TEXT_COLORS: Record<number, string> = {
  1: "text-red-400",
  2: "text-orange-400",
  3: "text-yellow-400",
  4: "text-lime-400",
  5: "text-green-400",
}

const MOOD_LABELS: Record<number, string> = {
  1: "Awful",
  2: "Bad",
  3: "OK",
  4: "Good",
  5: "Great",
}

const MOOD_EMOJIS: Record<number, string> = {
  1: "😴",
  2: "😕",
  3: "😐",
  4: "🙂",
  5: "😄",
}

function moodEmoji(avg: number): string {
  const rounded = Math.round(avg)
  return MOOD_EMOJIS[Math.max(1, Math.min(5, rounded))] ?? "😐"
}

function moodLabel(avg: number): string {
  const rounded = Math.round(avg)
  return MOOD_LABELS[Math.max(1, Math.min(5, rounded))] ?? "OK"
}

/** Build a 7-slot day array covering the last 7 days */
function buildWeekSlots(logs: MoodEntry[]): Array<{ dateStr: string; shortDay: string; entry: MoodEntry | null }> {
  const today = new Date()
  const logMap = new Map(logs.map(l => [l.date, l]))

  return Array.from({ length: 7 }, (_, i) => {
    const d = subDays(today, 6 - i)
    const dateStr = format(d, "yyyy-MM-dd")
    return {
      dateStr,
      shortDay: format(d, "EEE"),
      entry: logMap.get(dateStr) ?? null,
    }
  })
}

/** Hardcoded insight: compare mood on days with 7+ h sleep vs. less */
function buildInsight(logs: MoodEntry[]): string | null {
  const withSleep = logs.filter(l => l.sleepH != null)
  if (withSleep.length < 3) return null

  const goodSleep = withSleep.filter(l => l.sleepH! >= 7)
  const poorSleep = withSleep.filter(l => l.sleepH! < 7)

  if (goodSleep.length === 0 || poorSleep.length === 0) return null

  const avgGood = goodSleep.reduce((s, l) => s + l.mood, 0) / goodSleep.length
  const avgPoor = poorSleep.reduce((s, l) => s + l.mood, 0) / poorSleep.length
  const diff = avgGood - avgPoor

  if (diff >= 0.5) {
    return `You tend to feel better on days you sleep 7+ hours (avg ${avgGood.toFixed(1)} vs ${avgPoor.toFixed(1)})`
  }
  if (diff <= -0.5) {
    return `Interestingly, your mood is similar regardless of sleep length this period`
  }
  return null
}

function LoadingSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="h-4 bg-secondary rounded animate-pulse w-32" />
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-2 h-20 mb-3">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full bg-secondary rounded-sm animate-pulse"
                style={{ height: `${30 + (i % 3) * 15}px` }}
              />
              <div className="h-2 w-4 bg-secondary rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="h-3 bg-secondary rounded animate-pulse w-48" />
      </CardContent>
    </Card>
  )
}

export function MoodPatterns() {
  const [data, setData] = useState<MoodHistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch("/api/mood-history")
      .then(r => {
        if (!r.ok) throw new Error("fetch failed")
        return r.json()
      })
      .then((d: MoodHistoryResponse) => setData(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSkeleton />
  if (error) return null

  const allLogs = data?.logs ?? []

  // Only use last 14 days from API; show 7 in the chart
  const last14 = allLogs
  const last7Slots = buildWeekSlots(last14)
  const last7Logs = last7Slots.map(s => s.entry).filter((e): e is MoodEntry => e != null)

  // Empty state
  if (last7Logs.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Smile className="h-4 w-4 text-primary" /> Mood Patterns
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-4 text-center">
            Log your mood in the morning check-in to see patterns here
          </p>
        </CardContent>
      </Card>
    )
  }

  const weekAvg = last7Logs.reduce((s, l) => s + l.mood, 0) / last7Logs.length

  // Best day in the last 7
  const bestEntry = last7Logs.reduce((best, l) => (l.mood > best.mood ? l : best), last7Logs[0])
  const bestDayLabel = format(new Date(bestEntry.date + "T12:00:00"), "EEEE")

  const insight = buildInsight(last14)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-1.5">
          <Smile className="h-4 w-4 text-primary" /> Mood Patterns
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Chart row */}
        <div className="flex items-end gap-2">
          {/* Average mood summary */}
          <div className="flex flex-col items-center justify-end shrink-0 w-12 pb-5">
            <span className="text-3xl leading-none mb-0.5">{moodEmoji(weekAvg)}</span>
            <span className={`text-sm font-bold ${MOOD_TEXT_COLORS[Math.round(weekAvg)] ?? "text-foreground"}`}>
              {weekAvg.toFixed(1)}
            </span>
            <span className="text-[9px] text-muted-foreground">avg</span>
          </div>

          {/* Bar chart */}
          <div className="flex-1 flex items-end gap-1.5 h-[68px]">
            {last7Slots.map(({ dateStr, shortDay, entry }) => {
              const isToday = dateStr === format(new Date(), "yyyy-MM-dd")
              const barHeight = entry ? Math.round((entry.mood / 5) * 52) + 8 : 4
              const colorClass = entry ? (MOOD_BAR_COLORS[entry.mood] ?? "bg-primary") : "bg-secondary"
              return (
                <div key={dateStr} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className={`w-full rounded-sm transition-all ${colorClass} ${!entry ? "opacity-30" : ""}`}
                    style={{ height: `${barHeight}px` }}
                    title={entry ? `${shortDay}: ${MOOD_LABELS[entry.mood]}` : shortDay}
                  />
                  <span
                    className={`text-[9px] ${
                      isToday ? "font-bold text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {shortDay}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Stats strip */}
        <div className="flex items-center gap-4 text-xs flex-wrap">
          <div>
            <span className="text-muted-foreground">7-day avg </span>
            <span className={`font-semibold ${MOOD_TEXT_COLORS[Math.round(weekAvg)] ?? ""}`}>
              {weekAvg.toFixed(1)}/5 · {moodLabel(weekAvg)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Best day </span>
            <span className="font-semibold">{bestDayLabel}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Logged </span>
            <span className="font-semibold">{last7Logs.length}/7</span>
            <span className="text-muted-foreground"> days</span>
          </div>
        </div>

        {/* Correlation insight */}
        {insight && (
          <div className="rounded-lg bg-primary/5 border border-primary/10 px-3 py-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground">Insight: </span>
              {insight}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
