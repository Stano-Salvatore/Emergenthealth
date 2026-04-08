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

interface HealthEntryFormProps {
  onSaved?: () => void
}

export function HealthEntryForm({ onSaved }: HealthEntryFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    date: new Date().toISOString().split("T")[0],
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
        setOpen(false)
        onSaved?.()
        router.refresh()
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Saving..." : "Save"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
