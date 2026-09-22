"use client"

import { useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

interface DigestSections {
  sleep: boolean
  steps: boolean
  hrv: boolean
  habits: boolean
  mood: boolean
  focus: boolean
  weight: boolean
  strava: boolean
  github: boolean
  spending: boolean
  lastfm: boolean
}

interface DigestPrefs {
  sections: DigestSections
  thresholds: { minDays: number }
}

const defaultPrefs: DigestPrefs = {
  sections: {
    sleep: true,
    steps: true,
    hrv: true,
    habits: true,
    mood: true,
    focus: true,
    weight: true,
    strava: true,
    github: true,
    spending: true,
    lastfm: true,
  },
  thresholds: { minDays: 3 },
}

// Only the tiles the Sunday review email actually consults (`on(key)` in
// api/cron/emergy-weekly-review). Eleven toggles used to sit here; seven of
// them — mood, focus, weight, Strava, GitHub, Last.fm and a Spending one for
// a feature that no longer exists — were written to the preference and read
// by nothing, so a person switching Mood off watched a control that did
// nothing. The stored JSON still tolerates the old keys; they are just not
// offered as a promise the email cannot keep. digest-toggles-honoured.test.ts
// holds this list to the email's.
const SECTION_META: { key: keyof DigestSections; emoji: string; label: string }[] = [
  { key: "sleep",    emoji: "😴", label: "Sleep" },
  { key: "steps",    emoji: "👣", label: "Steps" },
  { key: "hrv",      emoji: "💓", label: "HRV" },
  { key: "habits",   emoji: "✅", label: "Habits" },
]

export function DigestPreferences() {
  const [prefs, setPrefs] = useState<DigestPrefs>(defaultPrefs)
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    fetch("/api/preferences/digest")
      .then(r => r.json())
      .then((data: DigestPrefs) => setPrefs({ ...defaultPrefs, ...data, sections: { ...defaultPrefs.sections, ...data.sections } }))
      .catch(() => null)
  }, [])

  function save(next: DigestPrefs) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSaveStatus("saving")
    debounceRef.current = setTimeout(async () => {
      try {
        await fetch("/api/preferences/digest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        })
        setSaveStatus("saved")
        setTimeout(() => setSaveStatus("idle"), 1500)
      } catch {
        setSaveStatus("idle")
      }
    }, 1000)
  }

  function toggleSection(key: keyof DigestSections) {
    const next: DigestPrefs = {
      ...prefs,
      sections: { ...prefs.sections, [key]: !prefs.sections[key] },
    }
    setPrefs(next)
    save(next)
  }

  function setMinDays(val: number) {
    const clamped = Math.max(1, Math.min(14, val))
    const next: DigestPrefs = { ...prefs, thresholds: { minDays: clamped } }
    setPrefs(next)
    if (!mountedRef.current) { mountedRef.current = true; return }
    save(next)
  }

  useEffect(() => { mountedRef.current = true }, [])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center justify-between">
          <span>Digest &amp; Alerts</span>
          {saveStatus === "saving" && <span className="text-[11px] font-normal text-muted-foreground">Saving…</span>}
          {saveStatus === "saved" && <span className="text-[11px] font-normal text-green-400">Saved</span>}
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Which stat tiles the Sunday review email carries under Emergy&apos;s write-up. The
          digest you send yourself below always includes all four.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {SECTION_META.map(({ key, emoji, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleSection(key)}
              className={[
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                prefs.sections[key]
                  ? "bg-primary/15 border-primary/30 text-primary"
                  : "bg-secondary/40 border-transparent text-muted-foreground",
              ].join(" ")}
            >
              <span>{emoji}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">
            Only include a metric if it has data from at least N days this week
          </label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={14}
              value={prefs.thresholds.minDays}
              onChange={e => setMinDays(Number(e.target.value))}
              className="w-20 h-8 text-sm"
            />
            <span className="text-xs text-muted-foreground">days (1–14)</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
