"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ChevronDown, ChevronUp } from "lucide-react"
import type { TidyPlan } from "@/lib/lab-recanonicalise"
import { labValueText } from "@/lib/lab-flags"

// Rows saved before 3.8.0 under names the marker map now files elsewhere.
// The card shows the server's plan and applies only its plain renames; the
// rows it can't settle by name are listed with the reason and left alone —
// deleting one is done on its marker card below, by a person who has the
// report in hand.

export function LabTidyCard({ onApplied }: { onApplied: () => void }) {
  const [plan, setPlan] = useState<TidyPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [showLooks, setShowLooks] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/labs/tidy")
      if (res.ok) setPlan(await res.json())
    } catch { /* the card simply doesn't show */ }
  }, [])

  useEffect(() => { load() }, [load])

  async function apply() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/labs/tidy", { method: "POST" })
      if (!res.ok) throw new Error()
      const r = await res.json() as { renamed: number; limits: number }
      const parts = [
        r.renamed > 0 ? `renamed ${r.renamed}` : null,
        r.limits > 0 ? `kept the < or > on ${r.limits}` : null,
      ].filter(Boolean)
      setDone(parts.length > 0 ? `Done — ${parts.join(", ")}.` : "Nothing needed changing after all.")
      await load()
      onApplied()
    } catch {
      setError("Couldn't tidy them — nothing was changed.")
    } finally {
      setBusy(false)
    }
  }

  if (!plan) return null
  const fixable = plan.renames.length + plan.limits.length
  const looks = plan.needsALook
  if (fixable === 0 && looks.length === 0 && !done) return null

  return (
    <Card className="border-border/60 bg-card/60">
      <CardContent className="pt-3 pb-3 space-y-2.5">
        <div className="min-w-0">
          <p className="text-xs font-semibold">🧹 Tidy lab names</p>
          <p className="text-[11px] text-muted-foreground">
            {fixable > 0
              ? `${fixable} lab result${fixable === 1 ? "" : "s"} saved by an older version ${fixable === 1 ? "uses" : "use"} an old name or kept a < or > only in a note — tidy them so each marker is one series.`
              : `${looks.length} lab result${looks.length === 1 ? "" : "s"} could use a look — a name alone can't settle ${looks.length === 1 ? "it" : "them"}.`}
          </p>
        </div>

        {fixable > 0 && (
          <ul className="space-y-0.5 text-[11px]">
            {plan.renames.map(r => (
              <li key={r.id} className="flex flex-wrap gap-x-1.5">
                <span className="text-muted-foreground">{r.date}</span>
                <span>{r.from}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-medium">{r.to}</span>
                <span className="text-muted-foreground tabular-nums">{labValueText(r.value, r.qualifier)} {r.unit}</span>
              </li>
            ))}
            {plan.limits.map(l => (
              <li key={`limit-${l.id}`} className="flex flex-wrap gap-x-1.5">
                <span className="text-muted-foreground">{l.date}</span>
                <span>{l.marker}</span>
                <span className="text-muted-foreground tabular-nums">{l.value}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-medium tabular-nums">{labValueText(l.value, l.qualifier)} {l.unit}</span>
              </li>
            ))}
          </ul>
        )}

        {looks.length > 0 && (
          <div className="space-y-1">
            {fixable > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {looks.length} more {looks.length === 1 ? "needs" : "need"} a look and won&apos;t be changed.
              </p>
            )}
            <button
              onClick={() => setShowLooks(s => !s)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {showLooks ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showLooks ? "Hide" : "Show"} {looks.length === 1 ? "it" : `the ${looks.length}`}
            </button>
            {showLooks && (
              <ul className="space-y-1.5">
                {looks.map(l => (
                  <li key={`${l.kind}-${l.id}`} className="rounded-md border border-border/50 px-2 py-1 text-[11px]">
                    <span className="text-muted-foreground">{l.date}</span>{" "}
                    <span className="font-medium">{l.marker}</span>{" "}
                    <span className="tabular-nums">{labValueText(l.value, l.qualifier)} {l.unit}</span>
                    <p className="text-[10px] text-amber-400 leading-snug">{l.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && <p className="text-[11px] text-rose-400">{error}</p>}
        {done && <p className="text-[11px] text-emerald-400">{done}</p>}

        {fixable > 0 && (
          <div className="flex justify-end">
            <Button size="sm" onClick={apply} disabled={busy}>
              {busy ? "Tidying…" : `Tidy ${fixable}`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
