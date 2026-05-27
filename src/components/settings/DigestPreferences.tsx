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

const SECTION_META: { key: keyof DigestSections; emoji: string; label: string }[] = [
  { key: "sleep",    emoji: "😴", label: "Sleep" },
  { key: "steps",    emoji: "👣", label: "Steps" },
  { key: "hrv",      emoji: "💓", label: "HRV" },
  { key: "habits",   emoji: "✅", label: "Habits" },
  { key: "mood",     emoji: "😊", label: "Mood" },
  { key: "focus",    emoji: "🎯", label: "Focus" },
  { key: "weight",   emoji: "⚖️", label: "Weight" },
  { key: "strava",   emoji: "🚴", label: "Strava" },
  { key: "github",   emoji: "💻", label: "GitHub" },
  { key: "spending", emoji: "💰", label: "Spending" },
  { key: "lastfm",   emoji: "🎵", label: "Last.fm" },
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
          Choose what appears in your weekly email digest
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
