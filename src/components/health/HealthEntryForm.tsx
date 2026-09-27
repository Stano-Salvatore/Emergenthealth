"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Plus } from "lucide-react"
import { listPhrase } from "@/lib/sync-status"

const FIELD_NAMES: Record<string, string> = {
  sleepDuration: "sleep", deepSleep: "deep sleep", remSleep: "REM sleep", lightSleep: "light sleep",
  steps: "steps", caloriesBurned: "calories", activeMinutes: "active minutes", restingHR: "resting HR",
}

const listFields = (cols: string[]) => listPhrase(cols.map(c => FIELD_NAMES[c] ?? c))

interface HealthEntryFormProps {
  onSaved?: () => void
}

export function HealthEntryForm({ onSaved }: HealthEntryFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState({
    date: (() => { const _d = new Date(); return [_d.getFullYear(), String(_d.getMonth()+1).padStart(2,"0"), String(_d.getDate()).padStart(2,"0")].join("-") })(),
    sleepHours: "",
    deepSleepMin: "",
    remMin: "",
    wakeTime: "",
    steps: "",
    caloriesBurned: "",
    restingHR: "",
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setNotice(null)
    setLoading(true)
    try {
      const res = await fetch("/api/sync/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: form.date,
          sleepHours: form.sleepHours ? Number(form.sleepHours) : undefined,
          deepSleepMin: form.deepSleepMin ? Number(form.deepSleepMin) : undefined,
          remMin: form.remMin ? Number(form.remMin) : undefined,
          wakeTime: form.wakeTime || undefined,
          steps: form.steps ? Number(form.steps) : undefined,
          caloriesBurned: form.caloriesBurned ? Number(form.caloriesBurned) : undefined,
          restingHR: form.restingHR ? Number(form.restingHR) : undefined,
        }),
      })
      if (res.ok) {
        const data = await res.json().catch(() => null) as { written?: string[]; kept?: string[] } | null
        onSaved?.()
        router.refresh()
        // A field the ring already holds is refused by the route; closing the
        // dialog would tell the user it saved.
        const kept = data?.kept ?? []
        if (kept.length === 0) {
          setOpen(false)
          return
        }
        const written = data?.written ?? []
        setNotice(
          (written.length ? `Saved ${listFields(written)}. ` : "Nothing saved. ") +
          `The ring already recorded ${listFields(kept)} for this day, and its reading stands.`,
        )
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) setNotice(null) }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1">
          <Plus className="h-4 w-4" /> Log Day
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle>Log Health Data</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={set("date")} className="mt-1" />
            </div>
            <div>
              <Label>Sleep (hours)</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="24"
                placeholder="7.5"
                value={form.sleepHours}
                onChange={set("sleepHours")}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Wake time</Label>
              <Input
                type="time"
                value={form.wakeTime}
                onChange={set("wakeTime")}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Deep sleep (min)</Label>
              <Input
                type="number"
                min="0"
                placeholder="90"
                value={form.deepSleepMin}
                onChange={set("deepSleepMin")}
                className="mt-1"
              />
            </div>
            <div>
              <Label>REM sleep (min)</Label>
              <Input
                type="number"
                min="0"
                placeholder="120"
                value={form.remMin}
                onChange={set("remMin")}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Steps</Label>
              <Input
                type="number"
                min="0"
                placeholder="8000"
                value={form.steps}
                onChange={set("steps")}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Resting HR (bpm)</Label>
              <Input
                type="number"
                min="0"
                placeholder="62"
                value={form.restingHR}
                onChange={set("restingHR")}
                className="mt-1"
              />
            </div>
          </div>
          {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Saving..." : "Save"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
