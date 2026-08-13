"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { Plus, Trash2, Bell, BellOff, X } from "lucide-react"

// The plan, and whether it happened. Ticking a dose off doesn't write a
// "completed" flag anywhere — it logs a real dose through the same endpoint as
// every other intake, so the schedule can never disagree with the dose history.

type DoseStatus = "taken" | "missed" | "upcoming"

interface ScheduledDose { scheduleId: string; name: string; time: string; status: DoseStatus }

interface Adherence { expected: number; taken: number; pct: number | null; missedDays: string[] }

interface ScheduleItem {
  id: string
  name: string
  dose: string | null
  times: string[]
  daysOfWeek: number[]
  active: boolean
  remind: boolean
  note: string | null
  runsToday: boolean
  today: ScheduledDose[]
  adherence: Adherence | null
}

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"]

const STATUS_STYLE: Record<DoseStatus, string> = {
  taken: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  missed: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  upcoming: "border-border bg-secondary/40 text-muted-foreground",
}

function adherenceColor(pct: number): string {
  if (pct >= 90) return "text-emerald-400"
  if (pct >= 70) return "text-amber-400"
  return "text-rose-400"
}

// ─── New / edit form ──────────────────────────────────────────────────────────

function ScheduleForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("")
  const [dose, setDose] = useState("")
  const [times, setTimes] = useState<string[]>(["08:00"])
  const [days, setDays] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function setTime(i: number, value: string) {
    setTimes(prev => prev.map((t, j) => (j === i ? value : t)))
  }

  async function save() {
    if (!name.trim() || times.length === 0) return
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch("/api/med-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), dose: dose.trim() || undefined, times, daysOfWeek: days }),
      })
      if (!res.ok) throw new Error()
      onDone()
    } catch {
      setErr("Couldn't save that — check the times and try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background/40 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">New schedule</p>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex gap-1.5">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Medication — e.g. Elicea 10 mg"
          className="flex-1 rounded-lg border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
        />
        <input
          value={dose}
          onChange={e => setDose(e.target.value)}
          placeholder="1 tablet"
          className="w-24 rounded-lg border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Times</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {times.map((t, i) => (
            <div key={i} className="flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1">
              <input
                type="time"
                value={t}
                onChange={e => setTime(i, e.target.value)}
                className="bg-transparent text-xs outline-none"
              />
              {times.length > 1 && (
                <button
                  onClick={() => setTimes(prev => prev.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-rose-400"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {times.length < 6 && (
            <button
              onClick={() => setTimes(prev => [...prev, "21:00"])}
              className="rounded-lg border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              + time
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Days {days.length === 0 && <span className="normal-case tracking-normal">— every day</span>}
        </p>
        <div className="flex gap-1">
          {DAY_LABELS.map((label, i) => {
            const on = days.length === 0 || days.includes(i)
            return (
              <button
                key={i}
                onClick={() => setDays(prev => {
                  // An empty list means "every day"; the first tap has to
                  // materialise that into a real set before removing one.
                  const base = prev.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : prev
                  const next = base.includes(i) ? base.filter(d => d !== i) : [...base, i].sort()
                  return next.length === 7 ? [] : next
                })}
                className={cn(
                  "h-7 w-7 rounded-md text-[11px] transition-colors",
                  on ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {err && <p className="text-[11px] text-rose-400">{err}</p>}

      <div className="flex justify-end gap-1.5">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={!name.trim() || saving}
          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save schedule"}
        </button>
      </div>
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function MedScheduleCard({ onDoseLogged }: { onDoseLogged?: () => void }) {
  const [items, setItems] = useState<ScheduleItem[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [windowDays, setWindowDays] = useState(14)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/med-schedule")
      if (!res.ok) return
      const data = await res.json()
      setItems(data.items ?? [])
      if (data.windowDays) setWindowDays(data.windowDays)
    } catch { /* leave the previous view in place */ }
  }, [])

  useEffect(() => { load() }, [load])

  async function takeNow(s: ScheduleItem) {
    setBusy(s.id)
    try {
      await fetch("/api/medications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: s.name, minutesAgo: 0 }),
      })
      await load()
      onDoseLogged?.()
    } finally {
      setBusy(null)
    }
  }

  async function toggleRemind(s: ScheduleItem) {
    setBusy(s.id)
    try {
      await fetch("/api/med-schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, remind: !s.remind }),
      })
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function remove(s: ScheduleItem) {
    if (!confirm(`Remove the schedule for ${s.name}? Doses you've already logged are kept.`)) return
    setBusy(s.id)
    try {
      await fetch(`/api/med-schedule?id=${encodeURIComponent(s.id)}`, { method: "DELETE" })
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (items === null) return null

  const todaysOutstanding = items
    .filter(s => s.runsToday)
    .reduce((n, s) => n + s.today.filter(d => d.status !== "taken").length, 0)

  return (
    <Card className="border-violet-500/20 bg-violet-500/5">
      <CardContent className="pt-3 pb-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold">
            📅 Today&apos;s plan
            {items.length > 0 && (
              <span className="ml-1.5 font-normal text-muted-foreground">
                {todaysOutstanding === 0 ? "all done" : `${todaysOutstanding} left`}
              </span>
            )}
          </p>
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3 w-3" /> Add
            </button>
          )}
        </div>

        {items.length === 0 && !adding && (
          <p className="text-[11px] text-muted-foreground">
            Add what you&apos;re meant to take and when. You&apos;ll get a reminder at each time
            you haven&apos;t logged it, and an honest adherence figure — worked out from the doses
            you actually logged, not from ticking a box.
          </p>
        )}

        {items.map(s => {
          const a = s.adherence
          return (
            <div key={s.id} className="rounded-xl border border-border/60 bg-card/60 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">
                    {s.name}
                    {s.dose && <span className="ml-1 font-normal text-muted-foreground">· {s.dose}</span>}
                  </p>
                  {a && a.pct !== null && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      <span className={adherenceColor(a.pct)}>{a.pct}%</span> taken over {windowDays} days
                      {a.missedDays.length > 0 && ` · ${a.missedDays.length} day${a.missedDays.length === 1 ? "" : "s"} incomplete`}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => toggleRemind(s)}
                    disabled={busy === s.id}
                    title={s.remind ? "Reminders on" : "Reminders off"}
                    className={cn("p-1 rounded-md transition-colors", s.remind ? "text-primary" : "text-muted-foreground/50")}
                  >
                    {s.remind ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    onClick={() => remove(s)}
                    disabled={busy === s.id}
                    className="p-1 rounded-md text-muted-foreground/50 hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {s.runsToday ? (
                  s.today.map(d => (
                    <span
                      key={d.time}
                      className={cn("rounded-lg border px-2 py-0.5 text-[11px] tabular-nums", STATUS_STYLE[d.status])}
                    >
                      {d.status === "taken" ? "✓ " : d.status === "missed" ? "! " : ""}{d.time}
                    </span>
                  ))
                ) : (
                  <span className="text-[11px] text-muted-foreground">Not scheduled today</span>
                )}
                {s.runsToday && s.today.some(d => d.status !== "taken") && (
                  <button
                    onClick={() => takeNow(s)}
                    disabled={busy === s.id}
                    className="ml-auto rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
                  >
                    {busy === s.id ? "…" : "Took it"}
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {adding && <ScheduleForm onDone={() => { setAdding(false); load() }} onCancel={() => setAdding(false)} />}
      </CardContent>
    </Card>
  )
}
