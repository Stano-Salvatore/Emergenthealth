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

// The picker that used to schedule an email nobody received: it wrote
// User.digestDay / digestHour, which only a cron endpoint outside the cron loop
// ever read. It now sets when Emergy's weekly review lands — the email that
// does arrive — in the user's own timezone.
export function WeeklyReviewSchedule() {
  const [day, setDay] = useState(0)
  const [hour, setHour] = useState(18)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(false)

  useEffect(() => {
    fetch("/api/weekly-review/schedule")
      .then(r => r.json())
      .then(d => { setDay(d.day ?? 0); setHour(d.hour ?? 18) })
      .catch(() => {})
  }, [])

  // "✓ Saved" only after the server said yes — this used to show it even when
  // the request failed, so a schedule could look set without being stored.
  async function save() {
    setSaving(true)
    setSaved(false)
    setSaveError(false)
    try {
      const res = await fetch("/api/weekly-review/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, hour }),
      })
      if (!res.ok) throw new Error()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm">Weekly review</h3>
      <p className="text-xs text-muted-foreground -mt-2">
        When Emergy&apos;s review of your week arrives — how the week actually went,
        and one thing for next week.
      </p>
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
        {saving ? "Saving…" : saved ? "Saved! ✓" : saveError ? "Retry" : "Save schedule"}
      </Button>
      {saveError && (
        <p className="text-xs text-red-400">Couldn&apos;t save the schedule — try again.</p>
      )}
      <p className="text-xs text-muted-foreground">
        Sent in your own timezone, and shown on the Week page whether or not the
        email reaches you.
      </p>
    </div>
  )
}
