"use client"

// Symptoms — how you actually feel, which every other page in this app was
// missing. Logging has to survive a bad day, so the whole flow is: tap the
// symptom, tap a severity, done.

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Loader2, Trash2, Plus, ChevronDown } from "lucide-react"
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

/** /api/symptoms/context — see lib/symptom-lookback. */
interface Lookback {
  factors: { key: string; text: string }[]
  steady: string[]
  unmeasured: string[]
  recurring: string[]
  episodes: number
}

const listWords = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`

// The look-back under a tapped entry. Too few headaches a month for any
// correlation card to pass its gate, so this answers the smaller question
// instead: what was different in the day and a half before this one.
function LookbackPanel({ data }: { data: Lookback | "error" | undefined }) {
  if (data === undefined) {
    return (
      <p className="px-3 pb-2.5 text-[10px] text-muted-foreground flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> looking back…
      </p>
    )
  }
  if (data === "error") {
    return <p className="px-3 pb-2.5 text-[10px] text-muted-foreground">Couldn’t read the day before — close and tap again to retry.</p>
  }
  return (
    <div className="mx-3 mb-2.5 pt-2 border-t border-border/60 space-y-1 text-[11px] leading-snug">
      {data.factors.length > 0 ? (
        <p>
          <span className="font-semibold">Before this one:</span>{" "}
          {data.factors.map(f => f.text).join(" · ")}
        </p>
      ) : data.steady.length > 0 ? (
        <p className="text-muted-foreground">
          Nothing stood out before this one — {listWords(data.steady)} were in your usual range.
        </p>
      ) : (
        <p className="text-muted-foreground">Too little of the day before was recorded to compare with your usual.</p>
      )}
      {data.recurring.map(r => <p key={r} className="text-primary">{r}</p>)}
      {data.episodes >= 3 && data.recurring.length === 0 && (
        <p className="text-muted-foreground">No one thing showed up before most of the last {data.episodes}.</p>
      )}
      {data.episodes < 3 && (
        <p className="text-[10px] text-muted-foreground/70">
          From the 3rd of these, this also shows what they had in common ({data.episodes} so far).
        </p>
      )}
      {data.unmeasured.length > 0 && (
        <p className="text-[10px] text-muted-foreground/60">Nothing to compare for {listWords(data.unmeasured)}.</p>
      )}
    </div>
  )
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

  // Tap-to-expand look-back. Cached per entry, and dropped whenever the list
  // changes: a new or deleted headache changes what "your last 4" means.
  const [openId, setOpenId] = useState<string | null>(null)
  const [context, setContext] = useState<Record<string, Lookback | "error">>({})

  async function toggle(id: string) {
    if (openId === id) { setOpenId(null); return }
    setOpenId(id)
    const cached = context[id]
    if (cached && cached !== "error") return
    setContext(c => { const next = { ...c }; delete next[id]; return next })
    try {
      const res = await fetch(`/api/symptoms/context?id=${encodeURIComponent(id)}`)
      if (!res.ok) throw new Error(String(res.status))
      const d = await res.json() as Lookback
      setContext(c => ({ ...c, [id]: d }))
    } catch {
      setContext(c => ({ ...c, [id]: "error" }))
    }
  }

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
        setContext({})
        await load()
      }
    } finally { setSaving(false) }
  }

  async function remove(id: string) {
    await fetch(`/api/symptoms?id=${id}`, { method: "DELETE" }).catch(() => null)
    setLogs(ls => ls.filter(l => l.id !== id))
    setContext({})
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
                  <div key={l.id} className="rounded-xl border bg-card">
                    <div className="flex items-center gap-3 px-3 py-2">
                      <span
                        className={cn("h-8 w-1.5 rounded-full shrink-0", SEVERITY[l.severity - 1]?.color ?? "bg-secondary")}
                        title={`Severity ${l.severity}/5`}
                      />
                      <button
                        onClick={() => toggle(l.id)}
                        aria-expanded={openId === l.id}
                        className="flex-1 min-w-0 flex items-center gap-2 text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{l.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {SEVERITY[l.severity - 1]?.label} · {format(new Date(l.loggedAt), "HH:mm")}
                            {l.note && ` · ${l.note}`}
                          </p>
                        </div>
                        <ChevronDown className={cn(
                          "h-3.5 w-3.5 text-muted-foreground/60 shrink-0 transition-transform",
                          openId === l.id && "rotate-180",
                        )} />
                      </button>
                      <button
                        onClick={() => remove(l.id)}
                        aria-label={`Delete ${l.name}`}
                        className="text-muted-foreground/50 hover:text-destructive transition-colors p-1 shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {openId === l.id && <LookbackPanel data={context[l.id]} />}
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
