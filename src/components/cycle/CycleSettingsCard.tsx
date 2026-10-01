"use client"

// Setting up and adjusting cycle tracking. The same form is the first-run
// setup (with a start button) and, once on, the settings at the bottom of the
// page. Nothing here is required: with no answers the page starts from 28
// days and learns the real cycle from the logged periods.

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CONTRACEPTION, cycleMode, PACKS, type Contraception, type CycleSettings, type PackKind } from "@/lib/cycle"
import { CONTRACEPTION_GUIDE } from "@/lib/cycle-guide"

interface Props {
  settings: CycleSettings
  today: string
  setup: boolean
  onSaved: (s: CycleSettings) => void
}

const PACK_LABEL: Record<PackKind, string> = { "21_7": "21 days + 7-day break", "24_4": "24 days + 4-day break", continuous: "Every day, no break" }

export function CycleSettingsCard({ settings, today, setup, onSaved }: Props) {
  const [draft, setDraft] = useState<CycleSettings>(settings)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pillNote, setPillNote] = useState<string | null>(null)

  const mode = cycleMode(draft.contraception)
  const set = <K extends keyof CycleSettings>(k: K, v: CycleSettings[K]) => setDraft(d => ({ ...d, [k]: v }))

  async function save(patch: Partial<CycleSettings>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/cycle/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, ...patch }),
      })
      if (!res.ok) throw new Error()
      const { settings: saved } = await res.json() as { settings: CycleSettings }
      setDraft(saved)
      onSaved(saved)
    } catch {
      setError("Not saved — try again.")
    } finally {
      setBusy(false)
    }
  }

  // A pill reminder through the medication schedule, rung only on active
  // pill days — the break week stays quiet.
  async function addPillReminder() {
    if (!draft.pack) return
    const p = PACKS[draft.pack.kind]
    const res = await fetch("/api/med-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: CONTRACEPTION_GUIDE[draft.contraception].name, times: ["21:00"],
        ...(p.active < p.length ? { packOnDays: p.active, packOffDays: p.length - p.active, packStart: draft.pack.start } : {}),
      }),
    }).catch(() => null)
    setPillNote(res?.ok
      ? "Added at 21:00, on active days only. The time and the rest are on the Medications page."
      : "Couldn't add it — try again, or add it on the Medications page.")
  }

  const num = (v: string, lo: number, hi: number): number | null => {
    const n = Number(v)
    return v.trim() === "" || !Number.isInteger(n) || n < lo || n > hi ? null : n
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">When did your last period start?</span>
        <input type="date" max={today} value={draft.lastStart ?? ""} onChange={e => set("lastStart", e.target.value || null)}
          className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" />
        <span className="text-[10px] text-muted-foreground">Optional. Once you log a period here, the logged days take over.</span>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Usual cycle (days)</span>
          <input type="number" inputMode="numeric" min={18} max={60} placeholder="28" value={draft.cycleLength ?? ""}
            onChange={e => set("cycleLength", num(e.target.value, 18, 60))} className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Usual period (days)</span>
          <input type="number" inputMode="numeric" min={1} max={12} placeholder="5" value={draft.periodLength ?? ""}
            onChange={e => set("periodLength", num(e.target.value, 1, 12))} className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" />
        </label>
      </div>
      <p className="text-[10px] text-muted-foreground -mt-2">Not sure? Leave them empty — after two logged cycles the app uses your own.</p>

      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Contraception</span>
        <select value={draft.contraception} onChange={e => set("contraception", e.target.value as Contraception)}
          className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm">
          {CONTRACEPTION.map(c => <option key={c} value={c}>{CONTRACEPTION_GUIDE[c].name}</option>)}
        </select>
        <span className="text-[10px] text-muted-foreground">{CONTRACEPTION_GUIDE[draft.contraception].summary}</span>
      </label>

      {mode === "pack" && (
        <div className="rounded-lg border px-3 py-3 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Pack</span>
            <select value={draft.pack?.kind ?? "21_7"}
              onChange={e => set("pack", { kind: e.target.value as PackKind, start: draft.pack?.start ?? today })}
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm">
              {(Object.keys(PACKS) as PackKind[]).map(k => <option key={k} value={k}>{PACK_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Day 1 of the current pack</span>
            <input type="date" max={today} value={draft.pack?.start ?? ""}
              onChange={e => set("pack", e.target.value ? { kind: draft.pack?.kind ?? "21_7", start: e.target.value } : null)}
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" />
          </label>
          {!setup && draft.pack && draft.contraception === "combined_pill" && (
            <div>
              <Button size="sm" variant="outline" onClick={addPillReminder}>Add a daily pill reminder</Button>
              {pillNote && <p className="text-[11px] text-muted-foreground mt-1.5">{pillNote}</p>}
            </div>
          )}
        </div>
      )}

      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={draft.headsUp} onChange={e => set("headsUp", e.target.checked)} className="mt-1" />
        <span>
          <span className="text-sm">A notification two days before</span>
          <span className="block text-[11px] text-muted-foreground">The home page always shows it. This adds a push that says only &quot;Cycle heads-up&quot; — nothing about periods on the lock screen — and puts the detail in your chat with Emergy.</span>
        </span>
      </label>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className={cn("flex gap-2", setup ? "flex-col" : "flex-row flex-wrap")}>
        <Button onClick={() => save(setup ? { enabled: true } : {})} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {setup ? "Start tracking" : "Save"}
        </Button>
        {!setup && (
          <Button variant="ghost" onClick={() => save({ enabled: false })} disabled={busy} className="text-muted-foreground">
            Turn off cycle tracking
          </Button>
        )}
      </div>
      {!setup && <p className="text-[10px] text-muted-foreground">Turning it off hides the page and the home card; the days you logged stay saved and come back if you turn it on again.</p>}
    </div>
  )
}
