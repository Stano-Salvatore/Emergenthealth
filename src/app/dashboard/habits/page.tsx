"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { CheckSquare, Flame, Plus, Check, Trash2, Trophy, CheckCircle2, RotateCcw, X, Zap } from "lucide-react"
import { EmptyState } from "@/components/ui/EmptyState"
import { cn } from "@/lib/utils"
import { format, subDays } from "date-fns"

interface Habit {
  id: string
  name: string
  description: string | null
  color: string
  streak: number
  completedToday: boolean
  completions: { date: string }[]
  reminderTime?: string | null
}

interface RoutineHabit {
  id: string
  name: string
  color: string
}

interface Routine {
  id: string
  name: string
  emoji: string
  habits: RoutineHabit[]
  completedCount: number
  totalCount: number
  allDone: boolean
}

function localDateStr(d: Date = new Date()): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-")
}

const COLORS = [
  "#6366f1","#22c55e","#f59e0b","#ef4444",
  "#8b5cf6","#06b6d4","#ec4899","#14b8a6",
]

const TEMPLATES = [
  { emoji: "⭐", name: "Morning Routine" },
  { emoji: "🌙", name: "Evening Routine" },
  { emoji: "💪", name: "Workout Prep" },
  { emoji: "🧘", name: "Mindfulness" },
]

function HeatmapRow({ habit, days }: { habit: Habit; days: Date[] }) {
  const doneSet = new Set(habit.completions.map(c => c.date?.split("T")[0]))
  const todayStr = localDateStr()
  return (
    <div className="flex gap-0.5">
      {days.map((d, i) => {
        const str = localDateStr(d)
        const done = doneSet.has(str)
        const isToday = str === todayStr
        return (
          <div key={i}
            className="h-3 flex-1 rounded-[2px] transition-all"
            style={{
              backgroundColor: done ? habit.color : "var(--secondary)",
              opacity: done ? 1 : isToday ? 0.55 : 0.35,
              outline: isToday ? `1.5px solid ${done ? habit.color : "var(--border)"}` : undefined,
              outlineOffset: "1px",
            }}
            title={`${format(d,"MMM d")}: ${done?"done":"not done"}`}
          />
        )
      })}
    </div>
  )
}

function RoutinesSection({ habits, onRefreshHabits }: { habits: Habit[]; onRefreshHabits: () => void }) {
  const [routines, setRoutines] = useState<Routine[]>([])
  const [loadingRoutines, setLoadingRoutines] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [completing, setCompleting] = useState<string | null>(null)
  const [formName, setFormName] = useState("")
  const [formEmoji, setFormEmoji] = useState("⭐")
  const [formHabitIds, setFormHabitIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  async function loadRoutines() {
    const res = await fetch("/api/routines")
    if (res.ok) setRoutines(await res.json())
    setLoadingRoutines(false)
  }

  useEffect(() => { loadRoutines() }, [])

  function applyTemplate(t: { emoji: string; name: string }) {
    setFormEmoji(t.emoji)
    setFormName(t.name)
  }

  function toggleHabitSelection(id: string) {
    setFormHabitIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function createRoutine(e: React.FormEvent) {
    e.preventDefault()
    if (!formName.trim()) return
    setSaving(true)
    const res = await fetch("/api/routines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: formName, emoji: formEmoji, habitIds: formHabitIds }),
    })
    if (res.ok) {
      setFormName(""); setFormEmoji("⭐"); setFormHabitIds([]); setShowForm(false)
      await loadRoutines()
    }
    setSaving(false)
  }

  async function completeRoutine(id: string) {
    setCompleting(id)
    await fetch(`/api/routines/${id}/complete`, { method: "POST" })
    await loadRoutines()
    onRefreshHabits()
    setCompleting(null)
  }

  async function deleteRoutine(id: string) {
    await fetch("/api/routines", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    await loadRoutines()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Routines</h2>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setShowForm(v => !v)}>
          <Plus className="h-3.5 w-3.5" /> New routine
        </Button>
      </div>

      {showForm && (
        <Card className="border-dashed">
          <CardContent className="pt-4 pb-4 space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-2">Templates</p>
              <div className="flex flex-wrap gap-2">
                {TEMPLATES.map(t => (
                  <button key={t.name} type="button" onClick={() => applyTemplate(t)}
                    className={cn(
                      "text-xs px-2.5 py-1 rounded-full border transition-colors",
                      formName === t.name && formEmoji === t.emoji
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-muted-foreground"
                    )}>
                    {t.emoji} {t.name}
                  </button>
                ))}
              </div>
            </div>
            <form onSubmit={createRoutine} className="space-y-4">
              <div className="flex gap-2">
                <div className="w-16">
                  <Label className="text-xs">Emoji</Label>
                  <Input className="mt-1 text-center text-lg px-1" value={formEmoji}
                    onChange={e => setFormEmoji(e.target.value)} maxLength={2} />
                </div>
                <div className="flex-1">
                  <Label className="text-xs">Name</Label>
                  <Input className="mt-1" placeholder="Morning Routine" value={formName}
                    onChange={e => setFormName(e.target.value)} autoFocus />
                </div>
              </div>
              {habits.length > 0 && (
                <div>
                  <Label className="text-xs">Habits to include</Label>
                  <div className="mt-2 space-y-1.5 max-h-44 overflow-y-auto">
                    {habits.map(h => (
                      <label key={h.id} className="flex items-center gap-2.5 cursor-pointer group">
                        <input type="checkbox" checked={formHabitIds.includes(h.id)}
                          onChange={() => toggleHabitSelection(h.id)} className="rounded" />
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: h.color }} />
                        <span className="text-sm group-hover:text-foreground text-muted-foreground transition-colors">{h.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit" size="sm" className="flex-1" disabled={saving || !formName.trim()}>
                  {saving ? "Creating…" : "Create routine"}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loadingRoutines ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[...Array(2)].map((_, i) => (
            <Card key={i}><CardContent className="py-3">
              <div className="h-4 bg-secondary rounded animate-pulse w-28 mb-2" />
              <div className="h-3 bg-secondary rounded animate-pulse w-16" />
            </CardContent></Card>
          ))}
        </div>
      ) : routines.length === 0 && !showForm ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          No routines yet — create one to complete multiple habits at once.
        </p>
      ) : routines.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {routines.map(routine => (
            <Card key={routine.id}
              className={cn("transition-all", routine.allDone && routine.totalCount > 0 ? "border-green-500/40 bg-green-500/[0.04]" : "")}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base leading-none">{routine.emoji}</span>
                      <p className="font-semibold text-sm truncate">{routine.name}</p>
                      {routine.allDone && routine.totalCount > 0 && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {routine.allDone && routine.totalCount > 0 ? "Completed!" : `${routine.completedCount}/${routine.totalCount} habits done`}
                    </p>
                    {routine.habits.length > 0 && (
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {routine.habits.slice(0, 5).map(h => (
                          <span key={h.id} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: h.color }} />
                            {h.name}
                          </span>
                        ))}
                        {routine.habits.length > 5 && <span className="text-[10px] text-muted-foreground">+{routine.habits.length - 5} more</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => deleteRoutine(routine.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <Button size="sm"
                      variant={routine.allDone && routine.totalCount > 0 ? "outline" : "default"}
                      className="h-7 text-xs gap-1"
                      disabled={completing === routine.id || routine.totalCount === 0}
                      onClick={() => completeRoutine(routine.id)}>
                      {completing === routine.id
                        ? <RotateCcw className="h-3 w-3 animate-spin" />
                        : routine.allDone && routine.totalCount > 0
                          ? <><Check className="h-3 w-3" /> Done</>
                          : "Complete all"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function HabitsPage() {
  const [habits, setHabits] = useState<Habit[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState(COLORS[0])
  const [newReminderTime, setNewReminderTime] = useState("")
  const [saving, setSaving] = useState(false)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [vacation, setVacation] = useState<{ active: boolean; from: string; until: string } | null>(null)
  const [showVacation, setShowVacation] = useState(false)
  const [vacFrom, setVacFrom] = useState(() => localDateStr())
  const [vacUntil, setVacUntil] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7); return localDateStr(d)
  })

  const days28 = Array.from({ length: 28 }, (_, i) => subDays(new Date(), 27 - i))

  async function loadHabits() {
    const res = await fetch("/api/habits")
    if (res.ok) setHabits(await res.json())
    setLoading(false)
  }

  useEffect(() => {
    loadHabits()
    fetch("/api/habits/vacation").then(r => r.json()).then(v => { if (v.from) setVacation(v) }).catch(() => {})
  }, [])

  async function createHabit(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setSaving(true)
    const res = await fetch("/api/habits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, color: newColor, reminderTime: newReminderTime || undefined }),
    })
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}))
      if (body.upgrade) {
        setSaving(false)
        setFormOpen(false)
        setShowUpgradeModal(true)
        return
      }
    }
    setNewName(""); setNewReminderTime(""); setFormOpen(false); setSaving(false)
    loadHabits()
  }

  async function toggleComplete(habit: Habit) {
    const url = `/api/habits/${habit.id}/complete`
    const dateStr = localDateStr()
    if (habit.completedToday) {
      await fetch(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: dateStr }) })
    } else {
      // Haptic feedback on completion
      if ("vibrate" in navigator) navigator.vibrate([30, 20, 60])
      await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: dateStr }) })
    }
    loadHabits()
  }

  async function deleteHabit(id: string) {
    await fetch(`/api/habits/${id}`, { method: "DELETE" })
    loadHabits()
  }

  async function saveVacation(active: boolean) {
    const body = { active, from: vacFrom, until: vacUntil }
    await fetch("/api/habits/vacation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    setVacation(active ? body : { active: false, from: vacFrom, until: vacUntil })
    setShowVacation(false)
    loadHabits()
  }

  const completed = habits.filter(h => h.completedToday).length
  const total = habits.length
  const completionRate = total > 0 ? completed / total : 0
  const topStreak = habits.reduce((max, h) => Math.max(max, h.streak), 0)

  return (
    <div className="space-y-6">
      {/* Upgrade modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowUpgradeModal(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-card border border-primary/30 p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center">
                <Zap className="h-5 w-5 text-primary" />
              </div>
              <button onClick={() => setShowUpgradeModal(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <h3 className="text-lg font-bold mb-1">You&apos;ve hit the free limit</h3>
            <p className="text-sm text-muted-foreground mb-5">
              Free plan supports up to 10 habits. Upgrade to Pro for unlimited habits, full history, and daily AI insights.
            </p>
            <div className="space-y-2.5 mb-5 text-sm">
              {["Unlimited habits & routines", "Full data history", "Daily AI insights", "Finance tracking"].map(f => (
                <div key={f} className="flex items-center gap-2">
                  <span className="text-primary">✓</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>
            <a
              href="/pricing"
              className="block w-full rounded-xl bg-primary py-3 text-center text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Start 14-day free trial →
            </a>
            <button
              onClick={() => setShowUpgradeModal(false)}
              className="mt-2.5 block w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Maybe later
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Habits</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {total > 0 ? `${completed} / ${total} done today` : "Track daily habits"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowVacation(v => !v)}
            className={cn(
              "text-xs px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5",
              vacation?.active
                ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                : "border-border text-muted-foreground hover:text-foreground"
            )}>
            🌴 {vacation?.active ? "Vacation on" : "Vacation"}
          </button>
          <Dialog open={formOpen} onOpenChange={setFormOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> New Habit</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border max-w-sm">
              <DialogHeader><DialogTitle>New Habit</DialogTitle></DialogHeader>
              <form onSubmit={createHabit} className="space-y-4">
                <div>
                  <Label>Name</Label>
                  <Input className="mt-1" placeholder="Morning run" value={newName}
                    onChange={e => setNewName(e.target.value)} autoFocus />
                </div>
                <div>
                  <Label>Color</Label>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {COLORS.map(c => (
                      <button key={c} type="button" onClick={() => setNewColor(c)}
                        className="h-7 w-7 rounded-full border-2 transition-transform"
                        style={{ backgroundColor: c, borderColor: newColor===c?"white":"transparent", transform: newColor===c?"scale(1.15)":"scale(1)" }} />
                    ))}
                  </div>
                </div>
                <div>
                  <Label>Reminder time <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                  <input type="time" value={newReminderTime} onChange={e => setNewReminderTime(e.target.value)}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                  <p className="text-[11px] text-muted-foreground mt-1">Get a push notification at this time if the habit isn&apos;t done yet</p>
                </div>
                <Button type="submit" className="w-full" disabled={saving || !newName.trim()}>
                  {saving ? "Creating…" : "Create"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Vacation mode panel */}
      {showVacation && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">🌴 Vacation / Streak Freeze</p>
            <button onClick={() => setShowVacation(false)} className="text-muted-foreground hover:text-foreground p-1"><X className="h-3.5 w-3.5" /></button>
          </div>
          <p className="text-xs text-muted-foreground">Missing habits during this period won&apos;t break your streaks.</p>
          <div className="flex gap-3 flex-wrap">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">From</label>
              <input type="date" value={vacFrom} onChange={e => setVacFrom(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Until</label>
              <input type="date" value={vacUntil} onChange={e => setVacUntil(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => saveVacation(true)} className="bg-amber-500 hover:bg-amber-600 text-black">
              {vacation?.active ? "Update freeze" : "Activate freeze"}
            </Button>
            {vacation?.active && (
              <Button size="sm" variant="outline" onClick={() => saveVacation(false)}>Deactivate</Button>
            )}
          </div>
        </div>
      )}

      {vacation?.active && !showVacation && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          <span>🌴</span>
          <span>Streaks frozen through {vacation.until} — enjoy your break!</span>
          <button onClick={() => saveVacation(false)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
        </div>
      )}

      <RoutinesSection habits={habits} onRefreshHabits={loadHabits} />

      {/* summary row */}
      {total > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-black">{completed}<span className="text-base text-muted-foreground font-normal">/{total}</span></p>
              <p className="text-xs text-muted-foreground mt-0.5">Done today</p>
              <Progress value={completionRate*100} className="h-1 mt-2" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-black text-orange-400">{topStreak}<span className="text-base text-muted-foreground font-normal">d</span></p>
              <p className="text-xs text-muted-foreground mt-0.5">Best streak</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-black">{Math.round(completionRate*100)}<span className="text-base text-muted-foreground font-normal">%</span></p>
              <p className="text-xs text-muted-foreground mt-0.5">Completion</p>
            </CardContent>
          </Card>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[...Array(4)].map((_,i) => (
            <Card key={i}><CardContent className="py-4">
              <div className="h-4 bg-secondary rounded animate-pulse w-24 mb-2" />
              <div className="h-3 bg-secondary rounded animate-pulse w-16" />
            </CardContent></Card>
          ))}
        </div>
      ) : habits.length === 0 ? (
        <EmptyState
          icon={<CheckSquare className="h-10 w-10" />}
          title="No habits yet"
          description="Add your first habit to start tracking streaks."
          action={{ label: "New Habit", onClick: () => setFormOpen(true) }}
        />
      ) : (
        <div className="space-y-3">
          {habits.map(habit => (
            <Card key={habit.id}
              className={`transition-all ${habit.completedToday ? "border-green-500/30 bg-green-500/[0.03]" : ""}`}>
              <CardContent className="py-4 px-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: habit.color }} />
                    <div className="min-w-0">
                      <p className="font-semibold text-sm">{habit.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Flame className="h-3 w-3 text-orange-400" />
                        <span className="text-xs text-muted-foreground">{habit.streak} day streak</span>
                        {habit.streak >= 7 && <Trophy className="h-3 w-3 text-amber-400" />}
                        {habit.reminderTime && (
                          <span className="text-xs text-muted-foreground">🔔 {habit.reminderTime}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => deleteHabit(habit.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => toggleComplete(habit)}
                      className={`h-9 w-9 rounded-full border-2 flex items-center justify-center transition-all ${
                        habit.completedToday ? "bg-green-500 border-green-500 text-white scale-110" : "border-border hover:border-green-500 hover:scale-105"
                      }`}>
                      {habit.completedToday && <Check className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[9px] text-muted-foreground mb-1">
                    <span>4 weeks ago</span><span>Today</span>
                  </div>
                  <HeatmapRow habit={habit} days={days28} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
