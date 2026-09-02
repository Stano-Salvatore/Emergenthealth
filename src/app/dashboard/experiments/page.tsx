"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { FlaskConical, Check, X, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { OUTCOMES, type ExperimentAnalysis, type PhaseDay } from "@/lib/experiments"

// The page that turns "these move together" into "this did something".
//
// Everything else in the app observes. Here the user commits to a question
// before seeing its answer, and the app holds them to the schedule — which is
// the entire difference between evidence and a story that fits.

type Experiment = {
  id: string
  name: string
  action: string
  outcome: string
  outcomeLabel: string
  blockDays: number
  blocks: number
  washoutDays: number
  startsOn: boolean
  startDate: string
  endDate: string
  totalDays: number
  status: string
  note: string | null
  loggedToday: boolean
  phase: { day: PhaseDay | null; dayIndex: number; daysLeft: number; finished: boolean }
  analysis: ExperimentAnalysis
}

const VERDICT_COPY: Record<ExperimentAnalysis["verdict"], { label: string; className: string }> = {
  "clear": { label: "Clear effect", className: "bg-emerald-500/15 text-emerald-400" },
  "suggestive": { label: "Suggestive", className: "bg-amber-500/15 text-amber-400" },
  "no-effect": { label: "No effect found", className: "bg-secondary text-muted-foreground" },
  "not-enough-data": { label: "Not enough data yet", className: "bg-secondary text-muted-foreground/70" },
}

function Analysis({ a, name }: { a: ExperimentAnalysis; name: string }) {
  const v = VERDICT_COPY[a.verdict]
  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-secondary/30 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-semibold">{a.outcomeLabel}</p>
        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", v.className)}>{v.label}</span>
      </div>

      {a.onAvg != null && a.offAvg != null ? (
        <>
          <div className="flex items-end gap-4 mb-2">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">On</p>
              <p className="text-lg font-black">{a.onAvg}{a.unit}</p>
              <p className="text-[10px] text-muted-foreground/70">{a.onN} days</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Off</p>
              <p className="text-lg font-black text-muted-foreground">{a.offAvg}{a.unit}</p>
              <p className="text-[10px] text-muted-foreground/70">{a.offN} days</p>
            </div>
            {a.diff != null && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Difference</p>
                <p className={cn("text-lg font-black", a.betterOnOn ? "text-emerald-400" : "text-amber-400")}>
                  {a.diff > 0 ? "+" : ""}{a.diff}{a.unit}
                </p>
                {a.pValue != null && <p className="text-[10px] text-muted-foreground/70">p = {a.pValue}</p>}
              </div>
            )}
          </div>

          {a.blockMeans.length > 1 && (
            <div className="flex gap-1.5 mb-2">
              {a.blockMeans.map(b => (
                <div key={b.block} className="flex-1 text-center">
                  <div className={cn("h-1 rounded-full mb-1", b.on ? "bg-primary" : "bg-muted-foreground/30")} />
                  <p className="text-[10px] text-muted-foreground">{b.mean ?? "—"}</p>
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground leading-snug">
            {a.verdict === "clear" && (
              <>An effect this size came up in only {Math.round((a.pValue ?? 0) * 100)}% of random shufflings of these same days — worth believing, for you.</>
            )}
            {a.verdict === "suggestive" && (
              <>Leaning that way, but chance alone produces a gap this big {Math.round((a.pValue ?? 0) * 100)}% of the time. Another round would settle it.</>
            )}
            {a.verdict === "no-effect" && (
              <>The on and off days aren&apos;t meaningfully apart — for {name.toLowerCase()}, on this outcome, at this dose.</>
            )}
            {a.verdict === "not-enough-data" && (
              <>Needs at least 4 usable days on each side. Keep logging.</>
            )}
          </p>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">Nothing to compare yet — the first results appear once both arms have days with data.</p>
      )}

      {(a.droppedWashout > 0 || a.droppedNonAdherent > 0 || a.droppedNoData > 0) && (
        <p className="text-[10px] text-muted-foreground/60 mt-2 leading-snug">
          Excluded: {[
            a.droppedWashout > 0 ? `${a.droppedWashout} washout` : null,
            a.droppedNonAdherent > 0 ? `${a.droppedNonAdherent} unlogged or off-plan` : null,
            a.droppedNoData > 0 ? `${a.droppedNoData} without a reading` : null,
          ].filter(Boolean).join(" · ")}.
        </p>
      )}
    </div>
  )
}

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  // New-experiment form
  const [name, setName] = useState("")
  const [action, setAction] = useState("")
  const [outcome, setOutcome] = useState("sleepScore")
  const [blockDays, setBlockDays] = useState(7)
  const [blocks, setBlocks] = useState(4)

  // Arriving from a "Test this" link on a Patterns card: the form comes
  // pre-filled and open, and the query is dropped so a refresh does not
  // re-open it.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const n = q.get("name"), a = q.get("action"), o = q.get("outcome")
    if (!n && !a) return
    // After the first paint, not during it: the URL is only readable on the
    // client, so the server-rendered form is empty and this fills it in.
    void Promise.resolve().then(() => {
      if (n) setName(n.slice(0, 80))
      if (a) setAction(a.slice(0, 200))
      if (o && OUTCOMES.some(x => x.key === o)) setOutcome(o)
      setCreating(true)
      window.history.replaceState(null, "", window.location.pathname)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/experiments")
        const d = await res.json().catch(() => null)
        if (cancelled) return
        if (res.ok) setExperiments(d?.experiments ?? [])
        else setError(d?.error ?? "Couldn't load your experiments.")
      } catch {
        if (!cancelled) setError("Couldn't load your experiments.")
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [nonce])

  const reload = () => setNonce(n => n + 1)

  async function create() {
    setBusy("create")
    setError(null)
    try {
      const res = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, action, outcome, blockDays, blocks }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) setError(d?.error ?? "Couldn't start that experiment.")
      else {
        setName(""); setAction(""); setCreating(false)
        reload()
      }
    } catch {
      setError("Couldn't start that experiment.")
    }
    setBusy(null)
  }

  async function logDay(id: string, adhered: boolean) {
    setBusy(id)
    try {
      const res = await fetch(`/api/experiments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adhered }),
      })
      if (res.ok) reload()
      else {
        const d = await res.json().catch(() => null)
        setError(d?.error ?? "Couldn't save that.")
      }
    } catch {
      setError("Couldn't save that.")
    }
    setBusy(null)
  }

  async function setStatus(id: string, status: string) {
    setBusy(id)
    try {
      const res = await fetch(`/api/experiments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (res.ok) reload()
    } catch { /* leave the list as it was */ }
    setBusy(null)
  }

  async function remove(id: string) {
    setBusy(id)
    try {
      const res = await fetch(`/api/experiments/${id}`, { method: "DELETE" })
      if (res.ok) reload()
    } catch { /* leave the list as it was */ }
    setBusy(null)
  }

  const running = experiments.filter(e => e.status === "running")
  const done = experiments.filter(e => e.status !== "running")

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FlaskConical className="h-6 w-6 text-primary shrink-0" /> Experiments
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Patterns tell you what moves together. An experiment tells you whether changing it does anything.
          </p>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium"
          >
            <Plus className="h-3.5 w-3.5" /> New experiment
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}

      {creating && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-4 pb-4 space-y-3">
            <p className="text-xs font-semibold">Design your experiment</p>

            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground">What are you testing?</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Magnesium before bed"
                className="w-full rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground">What exactly will you do on an ON day?</label>
              <input
                value={action}
                onChange={e => setAction(e.target.value)}
                placeholder="Take 300mg magnesium at 21:00"
                className="w-full rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground">
                What should it change? Pick one — choosing up front is what makes the answer trustworthy.
              </label>
              <select
                value={outcome}
                onChange={e => setOutcome(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
              >
                {OUTCOMES.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>

            <div className="flex gap-3">
              <div className="space-y-1.5 flex-1">
                <label className="text-[11px] text-muted-foreground">Days per block</label>
                <select
                  value={blockDays}
                  onChange={e => setBlockDays(Number(e.target.value))}
                  className="w-full rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                >
                  {[3, 5, 7, 10, 14].map(d => <option key={d} value={d}>{d} days</option>)}
                </select>
              </div>
              <div className="space-y-1.5 flex-1">
                <label className="text-[11px] text-muted-foreground">Blocks</label>
                <select
                  value={blocks}
                  onChange={e => setBlocks(Number(e.target.value))}
                  className="w-full rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                >
                  {[2, 4, 6].map(b => <option key={b} value={b}>{b} ({b / 2} on, {b / 2} off)</option>)}
                </select>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground leading-snug">
              {blockDays * blocks} days total. Blocks alternate on and off — which comes first is
              randomised — and the day after each switch is dropped from the analysis so yesterday&apos;s
              dose can&apos;t contaminate today&apos;s reading.
            </p>

            <div className="flex gap-2">
              <button
                onClick={create}
                disabled={!name.trim() || !action.trim() || busy === "create"}
                className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-40"
              >
                {busy === "create" ? "Starting…" : "Start today"}
              </button>
              <button
                onClick={() => { setCreating(false); setError(null) }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs"
              >
                Cancel
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="space-y-3 animate-pulse">
          {[...Array(2)].map((_, i) => <div key={i} className="h-32 bg-secondary rounded-xl" />)}
        </div>
      )}

      {!loading && experiments.length === 0 && !creating && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/50 px-8 py-16 text-center">
          <div className="mb-3 text-5xl leading-none select-none">🧪</div>
          <h3 className="text-base font-semibold">No experiments yet</h3>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground leading-relaxed">
            Pick one thing you&apos;ve wondered about — magnesium, no screens after 22:00, an earlier
            last coffee — and run it on and off for a few weeks. The app handles the schedule and the
            statistics; you just answer &quot;did you do it?&quot; each day.
          </p>
        </div>
      )}

      {running.map(e => (
        <Card key={e.id} className="border-primary/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold leading-snug">{e.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{e.action}</p>
                <p className="text-[11px] text-muted-foreground/70 mt-1">
                  Watching {e.outcomeLabel.toLowerCase()} · day {Math.max(1, e.phase.dayIndex)} of {e.totalDays}
                  {e.phase.daysLeft > 0 && ` · ${e.phase.daysLeft} to go`}
                </p>
              </div>
              <button
                onClick={() => remove(e.id)}
                disabled={busy === e.id}
                title="Delete this experiment"
                className="shrink-0 rounded-md p-1.5 text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Today */}
            {e.phase.day && (
              <div className={cn(
                "mt-3 rounded-lg border p-3",
                e.phase.day.on ? "border-primary/40 bg-primary/10" : "border-border bg-secondary/40"
              )}>
                <p className="text-xs font-bold uppercase tracking-widest mb-1">
                  {e.phase.day.on ? "🟢 Today is an ON day" : "⚪ Today is an OFF day"}
                  {e.phase.day.washout && <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground">· washout, not counted</span>}
                </p>
                <p className="text-sm mb-2">
                  {e.phase.day.on ? e.action : `Skip it today — no ${e.name.toLowerCase()}.`}
                </p>
                {e.loggedToday ? (
                  <p className="text-[11px] text-emerald-400">✓ Logged for today</p>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => logDay(e.id, true)}
                      disabled={busy === e.id}
                      className="flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-2.5 py-1 text-xs font-medium disabled:opacity-40"
                    >
                      <Check className="h-3 w-3" /> {e.phase.day.on ? "Did it" : "Stayed off it"}
                    </button>
                    <button
                      onClick={() => logDay(e.id, !e.phase.day!.on)}
                      disabled={busy === e.id}
                      className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs disabled:opacity-40"
                    >
                      <X className="h-3 w-3" /> {e.phase.day.on ? "Missed it" : "Slipped"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {e.phase.finished && (
              <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <p className="text-sm mb-2">All {e.totalDays} days are done.</p>
                <button
                  onClick={() => setStatus(e.id, "completed")}
                  disabled={busy === e.id}
                  className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium"
                >
                  Finish and keep the result
                </button>
              </div>
            )}

            <Analysis a={e.analysis} name={e.name} />
          </CardContent>
        </Card>
      ))}

      {done.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60 pt-2">Finished</p>
          {done.map(e => (
            <Card key={e.id}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug">{e.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{e.action}</p>
                    <p className="text-[11px] text-muted-foreground/70 mt-1">
                      {e.startDate} – {e.endDate} · {e.status}
                    </p>
                  </div>
                  <button
                    onClick={() => remove(e.id)}
                    disabled={busy === e.id}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Analysis a={e.analysis} name={e.name} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {experiments.length > 0 && (
        <p className="text-[11px] text-muted-foreground/60 leading-snug pt-2">
          A single-subject experiment answers what happens to <em>you</em>, and only for what you
          tested. You know which arm you&apos;re in, so expectation is part of the result — and one
          experiment can only speak about the outcome you chose at the start.
        </p>
      )}
    </div>
  )
}
