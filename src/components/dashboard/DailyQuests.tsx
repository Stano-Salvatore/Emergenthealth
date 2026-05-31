"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import type { Quest } from "@/app/api/quests/route"

interface QuestsData {
  quests: Quest[]
  totalXp: number
  maxXp: number
}

export function DailyQuests() {
  const [data, setData] = useState<QuestsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/quests")
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">⚔️ Daily Quests</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-10 animate-pulse bg-muted rounded-lg" />)}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  const { quests, totalXp, maxXp } = data
  const pct = maxXp > 0 ? Math.round((totalXp / maxXp) * 100) : 0
  const donePct = pct

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">⚔️ Daily Quests</CardTitle>
          <span className="text-xs text-muted-foreground font-medium">{totalXp}/{maxXp} XP</span>
        </div>
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden mt-1">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${donePct}%`,
              background: donePct >= 100 ? "linear-gradient(90deg,#22c55e,#4ade80)" : "linear-gradient(90deg, var(--primary), color-mix(in srgb, var(--primary) 70%, #fff))",
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="space-y-2">
          {quests.map(q => (
            <Link key={q.id} href={q.link ?? "#"} className="block">
              <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all hover:border-primary/30 ${
                q.done
                  ? "border-green-500/30 bg-green-500/5"
                  : "border-border bg-card/50 hover:bg-secondary/50"
              }`}>
                <span className="text-xl shrink-0">{q.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium leading-tight truncate ${q.done ? "line-through text-muted-foreground" : ""}`}>
                    {q.title}
                  </p>
                  <p className="text-xs text-muted-foreground">{q.desc}</p>
                </div>
                <div className={`shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded-md ${
                  q.done ? "bg-green-500/20 text-green-400" : "bg-primary/10 text-primary"
                }`}>
                  +{q.xp} XP
                </div>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
