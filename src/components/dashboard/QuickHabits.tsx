"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Flame, ChevronRight } from "lucide-react"
import Link from "next/link"

interface Habit {
  id: string
  name: string
  color: string
  completedToday: boolean
  streak: number
}

export function QuickHabits({ habits }: { habits: Habit[] }) {
  const [completed, setCompleted] = useState<Set<string>>(
    () => new Set(habits.filter(h => h.completedToday).map(h => h.id))
  )
  const [pending, setPending] = useState<Set<string>>(new Set())

  async function toggle(id: string) {
    if (pending.has(id)) return
    const isDone = completed.has(id)
    if (!isDone && "vibrate" in navigator) navigator.vibrate([30, 20, 60])
    setCompleted(prev => {
      const next = new Set(prev)
      isDone ? next.delete(id) : next.add(id)
      return next
    })
    setPending(prev => new Set(prev).add(id))
    try {
      await fetch(`/api/habits/${id}/complete`, {
        method: isDone ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    } catch {
      setCompleted(prev => {
        const next = new Set(prev)
        isDone ? next.add(id) : next.delete(id)
        return next
      })
    } finally {
      setPending(prev => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  const doneCount = completed.size
  const total = habits.length
  const allDone = total > 0 && doneCount === total
  const pct = total > 0 ? (doneCount / total) * 100 : 0

  return (
    <Card className="card-habits hover:border-amber-500/40 transition-all h-full hover:shadow-lg hover:shadow-amber-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
          <span className="flex items-center gap-1.5">✅ Habits</span>
          <Link href="/dashboard/habits" className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={e => e.stopPropagation()}>
            <span className={`text-xs font-normal tabular-nums ${allDone ? "text-green-400 font-semibold" : ""}`}>{doneCount}/{total}</span>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">No habits set up</p>
        ) : (
          <>
            <div className="mb-3">
              <Progress
                value={pct}
                className="h-1.5"
                style={allDone ? { "--progress-bg": "linear-gradient(90deg,#22c55e,#4ade80)" } as React.CSSProperties : undefined}
              />
            </div>

            {allDone ? (
              <div className="rounded-xl bg-green-500/10 border border-green-500/20 px-3 py-3 text-center">
                <p className="text-2xl mb-1">🎉</p>
                <p className="text-sm font-semibold text-green-400">All habits done!</p>
                <p className="text-xs text-muted-foreground mt-0.5">Great work today</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {habits.map(h => {
                  const done = completed.has(h.id)
                  const busy = pending.has(h.id)
                  return (
                    <button
                      key={h.id}
                      onClick={() => toggle(h.id)}
                      disabled={busy}
                      className="w-full flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-secondary/60 transition-colors text-left disabled:opacity-50"
                    >
                      <div
                        className={`h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${done ? "opacity-100 scale-110" : "opacity-40"}`}
                        style={{ borderColor: h.color, backgroundColor: done ? h.color : "transparent" }}
                      >
                        {done && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </div>
                      <span className={`text-sm flex-1 truncate transition-colors ${done ? "line-through text-muted-foreground/60" : ""}`}>
                        {h.name}
                      </span>
                      {h.streak > 0 && (
                        <span className="text-xs text-orange-400 font-medium shrink-0 flex items-center gap-0.5">
                          <Flame className="h-3 w-3" />{h.streak}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
