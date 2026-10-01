"use client"

// One day of the cycle, logged a tap at a time — every tap saves, so a bad
// day costs one touch, not a form. Only the field touched is sent; the
// server keeps the rest of the day as it was.

import { useState } from "react"
import { Loader2, Droplet, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { addDaysISO } from "@/lib/local-date"
import { FLOWS, type CycleDayLog, type Flow } from "@/lib/cycle"
import { CYCLE_MOODS, CYCLE_SYMPTOMS, DISCHARGES, PAIN_LABELS } from "@/lib/cycle-input"
import { shortDay } from "@/lib/cycle-text"

interface Props {
  day: string
  today: string
  log: CycleDayLog | undefined
  /** Days the logger may go back to — the server refuses older ones anyway. */
  earliest: string
  onDay: (day: string) => void
  onSaved: () => void
}

const FLOW_LABEL: Record<Flow, string> = { none: "None", spotting: "Spotting", light: "Light", medium: "Medium", heavy: "Heavy" }
const FLOW_DROPS: Record<Flow, number> = { none: 0, spotting: 0, light: 1, medium: 2, heavy: 3 }

function Chip({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-50",
        on ? "border-primary bg-primary/15 text-foreground font-medium" : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

export function DayLogger({ day, today, log, earliest, onDay, onSaved }: Props) {
  // Edits made here win over the props until the parent reloads with them.
  const [local, setLocal] = useState<{ day: string; log: CycleDayLog } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState<{ day: string; text: string } | null>(null)

  const current: CycleDayLog = local?.day === day ? local.log : log ?? { day, flow: null }
  const note = noteDraft?.day === day ? noteDraft.text : current.note ?? ""

  async function save(patch: Partial<CycleDayLog>) {
    const before = current
    setLocal({ day, log: { ...current, ...patch } })
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/cycle/day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, ...patch }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Not saved")
      onSaved()
    } catch (e) {
      setLocal({ day, log: before })
      setError(e instanceof Error ? e.message : "Not saved — try again.")
    } finally {
      setBusy(false)
    }
  }

  const toggle = (key: "symptoms" | "moods", value: string) => {
    const list = current[key] ?? []
    save({ [key]: list.includes(value) ? list.filter(v => v !== value) : [...list, value] })
  }

  const label = day === today ? "Today" : day === addDaysISO(today, -1) ? "Yesterday" : shortDay(day)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => onDay(addDaysISO(day, -1))} disabled={day <= earliest} className="p-1.5 rounded-md hover:bg-muted disabled:opacity-30" aria-label="Previous day">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-semibold flex items-center gap-2">
          {label}
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </p>
        <button onClick={() => onDay(addDaysISO(day, 1))} disabled={day >= today} className="p-1.5 rounded-md hover:bg-muted disabled:opacity-30" aria-label="Next day">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <section>
        <p className="text-xs font-medium text-muted-foreground mb-2">Bleeding</p>
        <div className="grid grid-cols-5 gap-1.5">
          {FLOWS.map(f => (
            <button
              key={f}
              onClick={() => save({ flow: current.flow === f ? null : f })}
              className={cn(
                "rounded-xl border py-2 flex flex-col items-center gap-1 text-[11px] transition-colors",
                current.flow === f ? "border-rose-400 bg-rose-500/15 text-foreground font-medium" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="flex h-4 items-center">
                {f === "spotting" ? <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                  : FLOW_DROPS[f] === 0 ? <span className="text-xs">—</span>
                  : Array.from({ length: FLOW_DROPS[f] }, (_, i) => <Droplet key={i} className="h-3.5 w-3.5 text-rose-400 fill-rose-400/60" />)}
              </span>
              {FLOW_LABEL[f]}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">Day 1 is the first day of real flow. &quot;None&quot; on a day tells the app the period has ended.</p>
      </section>

      <section>
        <p className="text-xs font-medium text-muted-foreground mb-2">Pain</p>
        <div className="flex flex-wrap gap-1.5">
          {PAIN_LABELS.map((p, i) => (
            <Chip key={p} on={current.pain === i} onClick={() => save({ pain: current.pain === i ? null : i })}>{p}</Chip>
          ))}
        </div>
      </section>

      <section>
        <p className="text-xs font-medium text-muted-foreground mb-2">Body</p>
        <div className="flex flex-wrap gap-1.5">
          {CYCLE_SYMPTOMS.map(s => (
            <Chip key={s.key} on={(current.symptoms ?? []).includes(s.key)} onClick={() => toggle("symptoms", s.key)}>{s.emoji} {s.label}</Chip>
          ))}
        </div>
      </section>

      <section>
        <p className="text-xs font-medium text-muted-foreground mb-2">Mood</p>
        <div className="flex flex-wrap gap-1.5">
          {CYCLE_MOODS.map(m => (
            <Chip key={m.key} on={(current.moods ?? []).includes(m.key)} onClick={() => toggle("moods", m.key)}>{m.emoji} {m.label}</Chip>
          ))}
        </div>
      </section>

      <details className="group">
        <summary className="text-xs font-medium text-muted-foreground cursor-pointer select-none">Discharge, ovulation test and a note</summary>
        <div className="space-y-3 mt-3">
          <div className="flex flex-wrap gap-1.5">
            {DISCHARGES.map(d => (
              <Chip key={d.key} on={current.discharge === d.key} onClick={() => save({ discharge: current.discharge === d.key ? null : d.key })}>{d.label}</Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[11px] text-muted-foreground mr-1">Ovulation test</span>
            <Chip on={current.lhTest === "positive"} onClick={() => save({ lhTest: current.lhTest === "positive" ? null : "positive" })}>Positive</Chip>
            <Chip on={current.lhTest === "negative"} onClick={() => save({ lhTest: current.lhTest === "negative" ? null : "negative" })}>Negative</Chip>
          </div>
          <textarea
            value={note}
            onChange={e => setNoteDraft({ day, text: e.target.value })}
            onBlur={() => { if (noteDraft?.day === day && noteDraft.text !== (current.note ?? "")) save({ note: noteDraft.text }) }}
            placeholder="A note for this day"
            rows={2}
            maxLength={500}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm resize-none"
          />
        </div>
      </details>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
