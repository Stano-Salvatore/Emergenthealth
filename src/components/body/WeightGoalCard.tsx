"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Target } from "lucide-react"
import type { WeightGoalProgress, WeightTrendPoint } from "@/lib/weight-trend"
import type { DailyTargets } from "@/lib/targets"

// The weight goal, read as a trend.
//
// Everything on this card is judged against the 7-day trend line, never the
// last reading — the copy in lib/weight-trend explains why. The chart draws
// both so the user can see the noise they are being told to ignore.

type Mode = "lose" | "gain" | "maintain"

interface Payload {
  goal: { mode: Mode | null; targetKg: number | null; paceKgWk: number | null; startKg: number | null; startedAt: string | null }
  heightCm: number | null
  latestKg: number | null
  series: WeightTrendPoint[]
  progress: WeightGoalProgress | null
  targets: DailyTargets
}

const MODE_LABEL: Record<Mode, string> = { lose: "Lose", gain: "Gain", maintain: "Maintain" }
const PACES = [0.25, 0.5, 0.75, 1.0]

const STATUS_LABEL: Record<WeightGoalProgress["status"], string> = {
  on_pace: "On pace", ahead: "Faster than planned", behind: "Behind pace", stalled: "Plateau",
  reversing: "Wrong way", holding: "Holding", drifting: "Drifting", reached: "Reached", no_data: "No data yet",
}
const STATUS_TONE: Record<WeightGoalProgress["status"], string> = {
  on_pace: "border-status-on/50 bg-status-on/10 text-status-on",
  holding: "border-status-on/50 bg-status-on/10 text-status-on",
  reached: "border-status-on/50 bg-status-on/10 text-status-on",
  ahead: "border-status-watch/50 bg-status-watch/10 text-status-watch",
  behind: "border-status-watch/50 bg-status-watch/10 text-status-watch",
  stalled: "border-status-watch/50 bg-status-watch/10 text-status-watch",
  drifting: "border-status-watch/50 bg-status-watch/10 text-status-watch",
  reversing: "border-status-off/50 bg-status-off/10 text-status-off",
  no_data: "border-border bg-muted/30 text-muted-foreground",
}

export function WeightGoalCard() {
  const [data, setData] = useState<Payload | null>(null)
  const [editing, setEditing] = useState(false)
  const [mode, setMode] = useState<Mode>("lose")
  const [targetKg, setTargetKg] = useState("")
  const [pace, setPace] = useState(0.5)
  const [saving, setSaving] = useState(false)

  const [reloadKey, setReloadKey] = useState(0)
  const load = useCallback(() => setReloadKey(k => k + 1), [])

  // Every state update lands after an await; `cancelled` drops a late answer
  // if the card unmounts first. Saves bump reloadKey to run it again.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch("/api/weight-goal").catch(() => null)
      if (!res?.ok || cancelled) return
      const d = await res.json() as Payload
      if (cancelled) return
      setData(d)
      if (d.goal.mode) {
        setMode(d.goal.mode)
        setTargetKg(d.goal.targetKg != null ? String(d.goal.targetKg) : "")
        setPace(d.goal.paceKgWk ?? 0.5)
      }
    })()
    return () => { cancelled = true }
  }, [reloadKey])

  async function save(next: { mode: Mode | null; targetKg?: number | null; paceKgWk?: number | null }) {
    setSaving(true)
    await fetch("/api/weight-goal", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next),
    }).catch(() => null)
    setSaving(false)
    setEditing(false)
    load()
  }

  if (!data) return null

  const { goal, progress, series, targets, latestKg } = data
  const hasGoal = goal.mode != null

  const editor = (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(["lose", "gain", "maintain"] as Mode[]).map(m => (
          <button
            key={m} type="button" onClick={() => setMode(m)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === m ? "border-fuel bg-fuel/15 text-fuel" : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
            }`}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] text-muted-foreground" htmlFor="weight-goal-target">
          {mode === "maintain" ? "Stay around" : "Target"}
        </label>
        <input
          id="weight-goal-target" type="number" step={0.1} min={20} max={400}
          value={targetKg} onChange={e => setTargetKg(e.target.value)}
          placeholder={latestKg != null ? String(latestKg) : "kg"}
          className="w-24 rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs tabular-nums"
        />
        <span className="text-[11px] text-muted-foreground">kg</span>
      </div>
      {mode !== "maintain" && (
        <div>
          <p className="text-[11px] text-muted-foreground mb-1.5">
            Pace <span className="text-muted-foreground/60">· kg per week — 0.25 to 0.75 is what holds</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PACES.map(p => (
              <button
                key={p} type="button" onClick={() => setPace(p)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium tabular-nums transition-colors ${
                  pace === p ? "border-fuel bg-fuel/15 text-fuel" : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          {pace >= 1 && (
            <p className="text-[11px] text-status-watch mt-1.5">A kilo a week means a large deficit; muscle goes with it. Fine for a short push, not for months.</p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex gap-2">
          <Button size="sm" disabled={saving} onClick={() => save({
            mode,
            targetKg: targetKg ? Number(targetKg) : mode === "maintain" ? latestKg : null,
            paceKgWk: mode === "maintain" ? null : pace,
          })}>
            {saving ? "Saving…" : hasGoal ? "Update goal" : "Set goal"}
          </Button>
          {hasGoal && <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
        </div>
        {hasGoal && (
          <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={saving} onClick={() => save({ mode: null })}>
            Remove goal
          </Button>
        )}
      </div>
    </div>
  )

  return (
    <Card className="rounded-2xl border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5"><Target className="h-4 w-4 text-fuel" /> Weight goal</span>
          {hasGoal && !editing && (
            <button onClick={() => setEditing(true)} className="text-xs font-normal text-muted-foreground hover:text-foreground">Edit</button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {(!hasGoal || editing) ? (
          <>
            {!hasGoal && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                Pick a direction and the app sets your calorie and protein targets to match, then judges progress on the weekly trend rather than the morning number.
              </p>
            )}
            {editor}
          </>
        ) : progress && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_TONE[progress.status]}`}>
                {STATUS_LABEL[progress.status]}
              </span>
              <p className="text-xs text-muted-foreground leading-relaxed flex-1 min-w-[12rem]">{progress.summary}</p>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="font-display text-xl leading-none text-fuel">{progress.trendKg ?? "—"}</p>
                <p className="text-[10px] text-muted-foreground mt-1">trend kg</p>
              </div>
              <div>
                <p className="font-display text-xl leading-none text-fuel">{goal.targetKg ?? "—"}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{goal.mode === "maintain" ? "stay near" : "target kg"}</p>
              </div>
              <div>
                <p className="font-display text-xl leading-none text-fuel">
                  {progress.slopeKgWk != null ? `${progress.slopeKgWk > 0 ? "+" : ""}${progress.slopeKgWk.toFixed(2)}` : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">kg / week</p>
              </div>
            </div>

            {goal.mode !== "maintain" && progress.fraction != null && (
              <div>
                <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                  <div className="h-full rounded-full bg-fuel transition-all" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>started {goal.startKg ?? "—"} kg{goal.startedAt ? ` · ${new Date(goal.startedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</span>
                  <span>{progress.remainingKg != null ? `${Math.abs(progress.remainingKg).toFixed(1)} kg to go` : ""}</span>
                </div>
              </div>
            )}

            <TrendChart series={series} targetKg={goal.targetKg} projectedKg={progress.projectedKg} />

            <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-3">
              Targets for this goal: <span className="text-foreground">{targets.calories} kcal</span>
              {targets.goalAdjustmentKcal !== 0 && (
                <> ({targets.goalAdjustmentKcal > 0 ? "+" : ""}{targets.goalAdjustmentKcal} vs maintenance)</>
              )}
              {" · "}<span className="text-foreground">{targets.proteinG} g protein</span>
              {goal.mode !== "maintain" && " (1.6 g/kg, so what changes is fat)"}.
              {targets.calorieBasis !== "bmr" && " Add height, birth year and sex under Intake to base this on a real BMR."}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function TrendChart({ series, targetKg, projectedKg }: { series: WeightTrendPoint[]; targetKg: number | null; projectedKg: number | null }) {
  if (series.length < 2) {
    return <p className="text-[11px] text-muted-foreground/70">Log weight on a few days and the trend line appears here.</p>
  }
  const W = 320, H = 96, PAD = 6
  const dayMs = 86_400_000
  const t0 = Date.parse(series[0].date)
  const t1 = Date.parse(series[series.length - 1].date)
  const tEnd = projectedKg != null ? t1 + 28 * dayMs : t1
  const ys = series.flatMap(p => [p.kg, p.trendKg])
  if (targetKg != null) ys.push(targetKg)
  if (projectedKg != null) ys.push(projectedKg)
  let lo = Math.min(...ys), hi = Math.max(...ys)
  if (hi - lo < 2) { const mid = (hi + lo) / 2; lo = mid - 1; hi = mid + 1 }
  const x = (t: number) => PAD + ((t - t0) / Math.max(1, tEnd - t0)) * (W - PAD * 2)
  const y = (v: number) => PAD + (1 - (v - lo) / (hi - lo)) * (H - PAD * 2)

  const trendPath = series.map((p, i) => `${i ? "L" : "M"}${x(Date.parse(p.date)).toFixed(1)},${y(p.trendKg).toFixed(1)}`).join(" ")
  const last = series[series.length - 1]

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24" role="img" aria-label="Weight trend">
        {targetKg != null && (
          <line x1={PAD} x2={W - PAD} y1={y(targetKg)} y2={y(targetKg)} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="3 3" />
        )}
        {series.map(p => (
          <circle key={p.date} cx={x(Date.parse(p.date))} cy={y(p.kg)} r={1.8} fill="var(--domain-fuel)" fillOpacity={0.35} />
        ))}
        <path d={trendPath} fill="none" stroke="var(--domain-fuel)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {projectedKg != null && (
          <line
            x1={x(t1)} y1={y(last.trendKg)} x2={x(tEnd)} y2={y(projectedKg)}
            stroke="var(--domain-fuel)" strokeWidth={1.5} strokeDasharray="4 3" strokeOpacity={0.6}
          />
        )}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground/70">
        <span>{new Date(t0).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
        <span>{new Date(t1).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}{projectedKg != null ? " → +4 wk" : ""}</span>
      </div>
      <p className="text-[10px] text-muted-foreground/60 mt-1">
        dots: readings · line: 7-day trend{projectedKg != null ? " · dashed: 4 weeks at this pace" : ""}{targetKg != null ? " · dotted: target" : ""}
      </p>
    </div>
  )
}
