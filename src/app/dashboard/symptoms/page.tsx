"use client"

// Symptoms — how you actually feel, which every other page in this app was
// missing. Logging has to survive a bad day, so the whole flow is: tap the
// symptom, tap a severity, done.

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Loader2, Trash2, Plus } from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"

interface SymptomLog {
  id: string
  name: string
  severity: number
  bodyPart: string | null
  note: string | null
  loggedAt: string
  day: string
}

// Only a starting vocabulary — the chips become whatever the user actually logs.
const STARTERS = [
  "Headache", "Fatigue", "Brain fog", "Nausea", "Anxiety",
  "Back pain", "Stomach ache", "Dizziness", "Sore throat", "Insomnia",
]

const SEVERITY = [
  { value: 1, label: "Barely", color: "bg-emerald-500" },
  { value: 2, label: "Mild", color: "bg-lime-500" },
  { value: 3, label: "Moderate", color: "bg-amber-500" },
  { value: 4, label: "Bad", color: "bg-orange-500" },
  { value: 5, label: "Severe", color: "bg-red-500" },
]

const WHEN = [
  { mins: 0, label: "now" },
  { mins: 120, label: "2h ago" },
  { mins: 480, label: "this morning" },
  { mins: 1440, label: "yesterday" },
]

export default function SymptomsPage() {
  const [logs, setLogs] = useState<SymptomLog[]>([])
  const [known, setKnown] = useState<{ name: string; count: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Draft: pick a symptom, then a severity — two taps and it's in.
  const [picked, setPicked] = useState<string | null>(null)
  const [custom, setCustom] = useState("")
  const [minutesAgo, setMinutesAgo] = useState(0)
  const [note, setNote] = useState("")

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/symptoms?days=30")
      if (res.ok) {
        const d = await res.json()
        setLogs(d.logs ?? [])
        setKnown(d.known ?? [])
      }
    } catch { /* keep what's on screen */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function log(name: string, severity: number) {
    setSaving(true)
    try {
      const res = await fetch("/api/symptoms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, severity, minutesAgo, note: note.trim() || undefined }),
      })
      if (res.ok) {
        setPicked(null); setCustom(""); setNote(""); setMinutesAgo(0)
        await load()
      }
    } finally { setSaving(false) }
  }

  async function remove(id: string) {
    await fetch(`/api/symptoms?id=${id}`, { method: "DELETE" }).catch(() => null)
    setLogs(ls => ls.filter(l => l.id !== id))
  }

  // Chips: what they log most, then starters they haven't used yet
  const knownNames = known.map(k => k.name)
  const chips = [...knownNames, ...STARTERS.filter(s => !knownNames.includes(s))].slice(0, 14)

  const byDay = logs.reduce<Record<string, SymptomLog[]>>((acc, l) => {
    (acc[l.day] ??= []).push(l)
    return acc
  }, {})
  const dayKeys = Object.keys(byDay).sort((a, b) => b.localeCompare(a))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Symptoms</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          How you feel — so the patterns can explain it
        </p>
      </div>

      {/* Log */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-3 pb-3 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs font-semibold whitespace-nowrap">🩹 Log a symptom</p>
            <div className="flex gap-1 flex-wrap justify-end">
              {WHEN.map(w => (
                <button
                  key={w.mins}
                  onClick={() => setMinutesAgo(w.mins)}
                  className={cn(
                    "px-2 py-0.5 rounded-md text-[10px] transition-colors",
                    minutesAgo === w.mins
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground hover:text-foreground",
                  )}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          {!picked ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {chips.map(name => (
                  <button
                    key={name}
                    onClick={() => setPicked(name)}
                    className="px-2.5 py-1 rounded-lg border border-border bg-card text-xs hover:border-primary/50 hover:bg-secondary/50 transition-colors"
                  >
                    {name}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input
                  value={custom}
                  onChange={e => setCustom(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && custom.trim()) setPicked(custom.trim()) }}
                  placeholder="Something else…"
                  className="flex-1 rounded-lg border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
                />
                <button
                  onClick={() => custom.trim() && setPicked(custom.trim())}
                  disabled={!custom.trim()}
                  className="px-3 py-1.5 rounded-lg bg-secondary text-xs font-medium disabled:opacity-40 flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" /> Add
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-2.5">
              <p className="text-sm">
                <span className="font-semibold">{picked}</span>
                <button onClick={() => setPicked(null)} className="ml-2 text-[10px] text-muted-foreground hover:text-foreground">change</button>
              </p>
              <p className="text-[10px] text-muted-foreground">How bad is it?</p>
              <div className="grid grid-cols-5 gap-1.5">
                {SEVERITY.map(s => (
                  <button
                    key={s.value}
                    onClick={() => log(picked, s.value)}
                    disabled={saving}
                    className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card py-2 hover:border-primary/50 transition-colors disabled:opacity-50"
                  >
                    <span className={cn("h-1.5 w-full max-w-[70%] rounded-full", s.color)} />
                    <span className="text-[10px] text-muted-foreground">{s.label}</span>
                  </button>
                ))}
              </div>
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Note (optional)"
                className="w-full rounded-lg border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
              />
              {saving && <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> saving…</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      {loading ? (
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : logs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="pt-8 pb-8 text-center space-y-2">
            <p className="text-4xl">🌤️</p>
            <p className="text-sm text-muted-foreground">Nothing logged yet.</p>
            <p className="text-xs text-muted-foreground/60 max-w-xs mx-auto">
              Log a symptom whenever one shows up. After a couple of weeks the Insights page
              starts testing it against your sleep, drinking, caffeine and medication.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {dayKeys.map(day => (
            <div key={day}>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                {format(new Date(day + "T12:00:00"), "EEE d MMM")}
              </p>
              <div className="space-y-1.5">
                {byDay[day].map(l => (
                  <div key={l.id} className="flex items-center gap-3 px-3 py-2 rounded-xl border bg-card">
                    <span
                      className={cn("h-8 w-1.5 rounded-full shrink-0", SEVERITY[l.severity - 1]?.color ?? "bg-secondary")}
                      title={`Severity ${l.severity}/5`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{l.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {SEVERITY[l.severity - 1]?.label} · {format(new Date(l.loggedAt), "HH:mm")}
                        {l.note && ` · ${l.note}`}
                      </p>
                    </div>
                    <button
                      onClick={() => remove(l.id)}
                      aria-label={`Delete ${l.name}`}
                      className="text-muted-foreground/50 hover:text-destructive transition-colors p-1 shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
