"use client"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6)

function formatHour(h: number) {
  if (h === 0) return "12:00 AM"
  if (h < 12) return `${h}:00 AM`
  if (h === 12) return "12:00 PM"
  return `${h - 12}:00 PM`
}

export function DigestSchedule() {
  const [day, setDay] = useState(1)
  const [hour, setHour] = useState(8)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch("/api/digest/schedule")
      .then(r => r.json())
      .then(d => { setDay(d.digestDay ?? 1); setHour(d.digestHour ?? 8) })
      .catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    await fetch("/api/digest/schedule", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ digestDay: day, digestHour: hour }),
    }).catch(() => {})
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm">Digest Schedule</h3>
      <div>
        <p className="text-xs text-muted-foreground mb-2">Day of week</p>
        <div className="flex gap-1 flex-wrap">
          {DAYS.map((d, i) => (
            <button
              key={d}
              onClick={() => setDay(i)}
              className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                day === i
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-muted"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-2">Time</p>
        <select
          value={hour}
          onChange={e => setHour(Number(e.target.value))}
          className="border border-border rounded px-3 py-1.5 text-sm bg-background"
        >
          {HOURS.map(h => (
            <option key={h} value={h}>{formatHour(h)}</option>
          ))}
        </select>
      </div>
      <Button size="sm" onClick={save} disabled={saving}>
        {saving ? "Saving…" : saved ? "Saved! ✓" : "Save schedule"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Digest emails will be sent automatically on your chosen schedule.
      </p>
    </div>
  )
}
