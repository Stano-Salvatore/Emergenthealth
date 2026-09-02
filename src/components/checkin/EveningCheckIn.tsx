"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Check, Loader2, MapPin, Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { localDayOf, tomorrowOf, SYMPTOM_STARTERS, SYMPTOM_SEVERITY } from "@/lib/checkin-mode"
import { resyncNotifications } from "@/lib/native/notifications"

// The other end of the day.
//
// The morning check-in asks what you intend; this asks what happened. Every
// step writes to somewhere that already exists — mood to MoodLog, symptoms to
// SymptomLog, the line to the same daily note the Journal page shows, and
// tomorrow's list to Reminder — so nothing here invents a private store that
// only this screen can read. That matters more than it sounds: the correlation
// engine, Emergy's context and the Insights page all read those tables, and a
// fifth copy of "how was today" would be invisible to every one of them.

type Step = 0 | 1 | 2 | 3 | "done"

const MOODS = [
  { value: 1, emoji: "😞", label: "Rough" },
  { value: 2, emoji: "😟", label: "Meh" },
  { value: 3, emoji: "😐", label: "OK" },
  { value: 4, emoji: "🙂", label: "Good" },
  { value: 5, emoji: "😄", label: "Great" },
]

interface PlaceStop {
  id: string
  placeName: string | null
  checkedAt: string
}

const STEP_LABELS = ["Today", "Where", "Body", "Tomorrow"]

function Progress({ step }: { step: Step }) {
  const current = step === "done" ? 4 : step
  return (
    <div className="mb-5">
      <div className="flex justify-between mb-2">
        {STEP_LABELS.map((label, i) => (
          <span
            key={label}
            className={cn(
              "text-xs transition-colors",
              i < current ? "text-primary" : i === current ? "text-foreground font-medium" : "text-muted-foreground/50",
            )}
          >
            {label}
          </span>
        ))}
      </div>
      <div className="h-1 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${(current / 4) * 100}%` }}
        />
      </div>
    </div>
  )
}

export function EveningCheckIn() {
  const [step, setStep] = useState<Step>(0)
  const [mood, setMood] = useState<number | null>(null)
  const [picked, setPicked] = useState<number | null>(null)

  const [stops, setStops] = useState<PlaceStop[] | null>(null)
  const [symptom, setSymptom] = useState<string | null>(null)
  const [customSymptom, setCustomSymptom] = useState("")
  const [loggedSymptoms, setLoggedSymptoms] = useState<string[]>([])

  const [note, setNote] = useState("")
  const [tomorrow, setTomorrow] = useState<string[]>([])
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)

  const today = localDayOf()

  // Today's automatic check-ins, so the recap is what actually happened rather
  // than a question. Nothing to answer here — it is the map's own record, and
  // the way to correct it is the Location page, which owns it.
  useEffect(() => {
    // Local midnight, spelled out rather than via setHours: the standing guard
    // in no-utc-day-bucketing.test.ts bans that call because it is almost
    // always the server's midnight in disguise. Here it would have been the
    // browser's — which IS the user's — but building the instant from the
    // local day string says so, and needs no exemption to prove it.
    const since = new Date(`${today}T00:00:00`)
    fetch(`/api/checkins?limit=20&since=${since.toISOString()}`)
      .then(r => (r.ok ? r.json() : []))
      .then(rows => setStops(Array.isArray(rows) ? rows : []))
      .catch(() => setStops([]))

    fetch(`/api/daily-note?date=${today}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.content) setNote(d.content) })
      .catch(() => {})
  }, [today])

  const pickMood = useCallback((value: number) => {
    setPicked(value)
    setMood(value)
    void fetch("/api/mood", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mood: value, date: today }),
    }).catch(() => {})
    setTimeout(() => { setStep(1); setPicked(null) }, 150)
  }, [today])

  async function logSymptom(name: string, severity: number) {
    await fetch("/api/symptoms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, severity }),
    }).catch(() => {})
    setLoggedSymptoms(s => [...s, name])
    setSymptom(null)
    setCustomSymptom("")
  }

  async function finish() {
    setSaving(true)
    try {
      if (note.trim()) {
        await fetch("/api/daily-note", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: note, date: today }),
        }).catch(() => {})
      }
      // Tomorrow's list becomes real reminders with a real date, so they show
      // up on the Reminders page and the phone schedules them — a note to self
      // that only this screen remembers is the thing being replaced here.
      const due = tomorrowOf()
      for (const title of tomorrow) {
        await fetch("/api/reminders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, dueDate: due, reminderTime: "09:00" }),
        }).catch(() => {})
      }
      if (tomorrow.length > 0) await resyncNotifications().catch(() => {})
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([30, 20, 60])
      setStep("done")
    } finally {
      setSaving(false)
    }
  }

  function addTomorrow() {
    const t = draft.trim()
    if (!t) return
    setTomorrow(list => [...list, t].slice(0, 5))
    setDraft("")
  }

  return (
    <div className="max-w-md mx-auto">
      <Progress step={step} />

      <Card>
        <CardContent className="pt-5 pb-5">
          {step === 0 && (
            <>
              <h2 className="text-xl font-bold text-center mb-1">How was today?</h2>
              <p className="text-xs text-muted-foreground text-center mb-5">Looking back, not forward</p>
              <div className="grid grid-cols-5 gap-1.5">
                {MOODS.map(m => (
                  <button
                    key={m.value}
                    onClick={() => pickMood(m.value)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-xl border py-3 transition-all",
                      picked === m.value ? "border-primary bg-primary/10 scale-95" : "border-border hover:border-primary/50",
                    )}
                  >
                    <span className="text-2xl leading-none">{m.emoji}</span>
                    <span className="text-[10px] text-muted-foreground">{m.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="text-xl font-bold text-center mb-1">Where you were</h2>
              <p className="text-xs text-muted-foreground text-center mb-4">
                What the map logged for you today
              </p>
              {stops === null ? (
                <p className="text-sm text-muted-foreground text-center py-4">Reading today…</p>
              ) : stops.length === 0 ? (
                <div className="text-center py-4 space-y-2">
                  <MapPin className="h-6 w-6 mx-auto text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No places logged today.</p>
                  <p className="text-xs text-muted-foreground/70">
                    Visits appear once you&apos;ve saved a place and background tracking is on.
                  </p>
                </div>
              ) : (
                <ul className="space-y-1.5 mb-3">
                  {stops.map(s => (
                    <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
                      <span className="text-sm truncate">{s.placeName ?? "Somewhere"}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(s.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center justify-between gap-2 mt-4">
                <Link href="/dashboard/location" className="text-xs text-muted-foreground underline">
                  Open the map
                </Link>
                <Button size="sm" onClick={() => setStep(2)}>Next →</Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-xl font-bold text-center mb-1">Anything bothering you?</h2>
              <p className="text-xs text-muted-foreground text-center mb-4">
                Optional — skip if nothing did
              </p>

              {loggedSymptoms.length > 0 && (
                <p className="text-xs text-emerald-400 mb-3 text-center">
                  Logged: {loggedSymptoms.join(", ")}
                </p>
              )}

              {symptom === null ? (
                <>
                  <div className="flex flex-wrap gap-1.5 justify-center">
                    {SYMPTOM_STARTERS.map(name => (
                      <button
                        key={name}
                        onClick={() => setSymptom(name)}
                        className="rounded-full border border-border px-3 py-1.5 text-xs hover:border-primary/50 transition-colors"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Input
                      value={customSymptom}
                      onChange={e => setCustomSymptom(e.target.value)}
                      placeholder="Something else…"
                      className="text-sm"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!customSymptom.trim()}
                      onClick={() => setSymptom(customSymptom.trim())}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </>
              ) : (
                <div className="space-y-2.5">
                  <p className="text-sm text-center">
                    <span className="font-semibold">{symptom}</span>
                    <button onClick={() => setSymptom(null)} className="ml-2 text-[10px] text-muted-foreground underline">
                      change
                    </button>
                  </p>
                  <p className="text-[10px] text-muted-foreground text-center">How bad was it?</p>
                  <div className="grid grid-cols-5 gap-1.5">
                    {SYMPTOM_SEVERITY.map(s => (
                      <button
                        key={s.value}
                        onClick={() => void logSymptom(symptom, s.value)}
                        className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card py-2 hover:border-primary/50 transition-colors"
                      >
                        <span className={cn("h-1.5 w-full max-w-[70%] rounded-full", s.color)} />
                        <span className="text-[10px] text-muted-foreground">{s.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 mt-5">
                <button onClick={() => setStep(3)} className="text-sm text-muted-foreground hover:text-foreground">
                  {loggedSymptoms.length > 0 ? "Done" : "Nothing"}
                </button>
                <Button size="sm" onClick={() => setStep(3)}>Next →</Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-xl font-bold text-center mb-1">Before you put it down</h2>
              <p className="text-xs text-muted-foreground text-center mb-4">
                A line about today, and anything not to forget tomorrow
              </p>

              <Textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="How today actually went…"
                rows={3}
                className="text-sm mb-4"
              />

              <p className="text-xs font-medium text-muted-foreground mb-2">Don&apos;t forget tomorrow</p>
              {tomorrow.length > 0 && (
                <ul className="space-y-1.5 mb-2">
                  {tomorrow.map((t, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-1.5">
                      <span className="text-sm truncate">{t}</span>
                      <button
                        onClick={() => setTomorrow(list => list.filter((_, j) => j !== i))}
                        aria-label={`Remove ${t}`}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Input
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTomorrow() } }}
                  placeholder="Call the dentist…"
                  className="text-sm"
                  disabled={tomorrow.length >= 5}
                />
                <Button variant="outline" size="sm" onClick={addTomorrow} disabled={!draft.trim() || tomorrow.length >= 5}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground/70 mt-1.5">
                These become reminders for tomorrow at 09:00.
              </p>

              <Button className="w-full mt-5 gap-2" onClick={finish} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Finish
              </Button>
            </>
          )}

          {step === "done" && (
            <div className="text-center py-4 space-y-3">
              <p className="text-4xl">{MOODS.find(m => m.value === mood)?.emoji ?? "🌙"}</p>
              <h2 className="text-xl font-bold">That&apos;s today done</h2>
              <div className="text-sm text-muted-foreground space-y-1">
                {loggedSymptoms.length > 0 && <p>{loggedSymptoms.length} symptom{loggedSymptoms.length > 1 ? "s" : ""} logged</p>}
                {note.trim() && <p>Journal saved</p>}
                {tomorrow.length > 0 && (
                  <p>{tomorrow.length} reminder{tomorrow.length > 1 ? "s" : ""} set for tomorrow morning</p>
                )}
              </div>
              <div className="flex gap-2 justify-center pt-1">
                <Button variant="outline" size="sm" onClick={() => setStep(0)}>Go again</Button>
                <Link href="/dashboard"><Button size="sm">Home</Button></Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
