"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import Link from "next/link"
import { Flame, Zap } from "lucide-react"
import { DailyTags } from "@/components/dashboard/DailyTags"

type CheckIn = {
  energy: number
  mood: number
  intention: string | null
  waterGoalMl: number
}

const ENERGY_OPTIONS = [
  { value: 1, emoji: "😴", label: "Exhausted" },
  { value: 2, emoji: "😪", label: "Tired" },
  { value: 3, emoji: "😐", label: "OK" },
  { value: 4, emoji: "😊", label: "Good" },
  { value: 5, emoji: "⚡", label: "Amazing" },
]

const MOOD_OPTIONS = [
  { value: 1, emoji: "😞", label: "Low" },
  { value: 2, emoji: "😟", label: "Meh" },
  { value: 3, emoji: "😐", label: "Neutral" },
  { value: 4, emoji: "🙂", label: "Good" },
  { value: 5, emoji: "😄", label: "Great" },
]

const WATER_OPTIONS = [1500, 2000, 2500, 3000]

const STEP_LABELS = ["Energy", "Mood", "Focus", "Water"]

export default function CheckInPage() {
  const [step, setStep] = useState<0 | 1 | 2 | 3 | "done">(0)
  const [energy, setEnergy] = useState<number | null>(null)
  const [mood, setMood] = useState<number | null>(null)
  const [intention, setIntention] = useState("")
  const [waterGoalMl, setWaterGoalMl] = useState<number>(2000)
  const [existing, setExisting] = useState<CheckIn | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedEnergy, setSelectedEnergy] = useState<number | null>(null)
  const [selectedMood, setSelectedMood] = useState<number | null>(null)
  const [streak, setStreak] = useState(0)
  const [isNewCheckin, setIsNewCheckin] = useState(false)

  useEffect(() => {
    const today = new Date()
    const localDate = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-")
    fetch(`/api/morning-checkin?date=${localDate}`)
      .then(r => r.json())
      .then(data => {
        if (data.checkin) {
          setExisting(data.checkin)
          setStep("done")
        }
        if (data.streak) setStreak(data.streak)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function save(waterMl: number) {
    const today = new Date()
    const localDate = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-")
    const res = await fetch("/api/morning-checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        energy,
        mood,
        intention: intention.trim() || null,
        waterGoalMl: waterMl,
        date: localDate,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.streak) setStreak(data.streak)
    setIsNewCheckin(true)
    // Haptic feedback: short buzz on completion
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([30, 20, 60, 20, 100])
    }
  }

  function handleEnergySelect(value: number) {
    setSelectedEnergy(value)
    setEnergy(value)
    setTimeout(() => { setStep(1); setSelectedEnergy(null) }, 150)
  }

  function handleMoodSelect(value: number) {
    setSelectedMood(value)
    setMood(value)
    setTimeout(() => { setStep(2); setSelectedMood(null) }, 150)
  }

  function ProgressBar() {
    const current = step === "done" ? 4 : (step as number)
    const pct = (current / 4) * 100
    return (
      <div className="mb-8">
        <div className="flex justify-between mb-2">
          {STEP_LABELS.map((label, i) => (
            <span
              key={label}
              className={`text-[10px] font-medium transition-colors ${
                i < current ? "text-primary" : i === current ? "text-foreground" : "text-muted-foreground/50"
              }`}
            >
              {label}
            </span>
          ))}
        </div>
        <div className="h-1 rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{ width: `${pct}%`, background: "var(--primary)" }}
          />
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center px-4 pt-6 pb-10" style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}>
        <div className="w-full max-w-sm space-y-6 animate-pulse">
          <div className="h-1 rounded-full bg-border w-full" />
          <div className="rounded-xl border bg-card p-6 space-y-4">
            <div className="h-5 rounded bg-border w-48 mx-auto" />
            <div className="grid grid-cols-5 gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 rounded-xl bg-border" />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    // Top-aligned, not vertically centered: the "done" state is taller than the
    // viewport (completion card + summary + tags + quick actions), and centering
    // it inside 100vh pushed the top off-screen and clipped the bottom behind the
    // Android nav bar — you had to scroll to find things. Flowing from the top
    // (with safe-area padding) keeps everything reachable with a normal scroll.
    <div
      className="flex flex-col items-center px-4 pt-6 pb-10"
      style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}
    >
      <div className="w-full max-w-sm">
        {step !== "done" && <ProgressBar />}

        {step === 0 && (
          <Card>
            <CardContent className="pt-8 pb-6 px-6">
              <p className="text-center text-xl font-semibold mb-6">How&apos;s your energy?</p>
              <div className="grid grid-cols-5 gap-2">
                {ENERGY_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleEnergySelect(opt.value)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 min-h-[72px] transition-all duration-150 active:scale-95 ${
                      selectedEnergy === opt.value
                        ? "border-primary bg-primary/10 scale-105"
                        : "border-border hover:border-primary/40 hover:bg-primary/5"
                    }`}
                  >
                    <span className="text-2xl leading-none">{opt.emoji}</span>
                    <span className="text-[10px] text-muted-foreground text-center leading-tight">{opt.label}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {step === 1 && (
          <Card>
            <CardContent className="pt-8 pb-6 px-6">
              <p className="text-center text-xl font-semibold mb-6">How&apos;s your mood?</p>
              <div className="grid grid-cols-5 gap-2">
                {MOOD_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleMoodSelect(opt.value)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 min-h-[72px] transition-all duration-150 active:scale-95 ${
                      selectedMood === opt.value
                        ? "border-primary bg-primary/10 scale-105"
                        : "border-border hover:border-primary/40 hover:bg-primary/5"
                    }`}
                  >
                    <span className="text-2xl leading-none">{opt.emoji}</span>
                    <span className="text-[10px] text-muted-foreground text-center leading-tight">{opt.label}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <CardContent className="pt-8 pb-6 px-6">
              <p className="text-center text-xl font-semibold mb-2">What&apos;s your focus today?</p>
              <p className="text-center text-sm text-muted-foreground mb-5">Optional — skip if you prefer</p>
              <Textarea
                value={intention}
                onChange={e => setIntention(e.target.value)}
                placeholder="e.g. deep work on the project, stay calm, exercise..."
                className="resize-none mb-4"
                rows={3}
                autoFocus
              />
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setStep(3)}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Skip
                </button>
                <Button onClick={() => setStep(3)} size="sm">
                  Next →
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 3 && (
          <Card>
            <CardContent className="pt-8 pb-6 px-6">
              <p className="text-center text-xl font-semibold mb-2">Daily water goal?</p>
              <p className="text-center text-sm text-muted-foreground mb-6">Tap to save and finish</p>
              <div className="grid grid-cols-2 gap-3">
                {WATER_OPTIONS.map(ml => (
                  <button
                    key={ml}
                    onClick={async () => {
                      setWaterGoalMl(ml)
                      await save(ml)
                      setStep("done")
                    }}
                    className="flex flex-col items-center justify-center rounded-xl border border-border py-4 min-h-[72px] text-lg font-bold hover:border-primary/40 hover:bg-primary/5 transition-all active:scale-95"
                  >
                    {ml >= 1000 ? `${ml / 1000}L` : `${ml}ml`}
                    <span className="text-xs font-normal text-muted-foreground mt-0.5">{ml}ml</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {step === "done" && (
          <div className="space-y-4">
            <Card className="border-primary/30 bg-primary/5 overflow-hidden">
              <CardContent className="pt-8 pb-6 px-6 text-center">
                <p className={`text-5xl mb-3 ${isNewCheckin ? "animate-bounce" : ""}`}>
                  {isNewCheckin ? "🎉" : "✅"}
                </p>
                <p className="text-xl font-semibold mb-0.5">
                  {isNewCheckin ? "Check-in complete!" : "All set for today!"}
                </p>
                {isNewCheckin && (
                  <p className="text-sm text-muted-foreground mb-3">Nice work starting the day intentionally.</p>
                )}

                {/* XP + Streak row */}
                <div className="flex items-center justify-center gap-3 mt-3 mb-4">
                  {isNewCheckin && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary px-3 py-1 text-xs font-semibold">
                      <Zap className="h-3 w-3" />
                      +10 XP
                    </span>
                  )}
                  {streak > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 text-orange-500 px-3 py-1 text-xs font-semibold">
                      <Flame className="h-3 w-3" />
                      {streak} day streak
                    </span>
                  )}
                </div>

                {/* Summary */}
                {(() => {
                  const src = existing ?? { energy, mood, intention: intention.trim() || null, waterGoalMl }
                  return (
                    <div className="mt-1 space-y-1.5 text-sm text-muted-foreground text-left bg-background/60 rounded-xl px-4 py-3">
                      <p>
                        <span className="font-medium text-foreground">Energy:</span>{" "}
                        {ENERGY_OPTIONS.find(o => o.value === src.energy)?.emoji}{" "}
                        {ENERGY_OPTIONS.find(o => o.value === src.energy)?.label}
                      </p>
                      <p>
                        <span className="font-medium text-foreground">Mood:</span>{" "}
                        {MOOD_OPTIONS.find(o => o.value === src.mood)?.emoji}{" "}
                        {MOOD_OPTIONS.find(o => o.value === src.mood)?.label}
                      </p>
                      {src.intention && (
                        <p>
                          <span className="font-medium text-foreground">Focus:</span>{" "}
                          {src.intention}
                        </p>
                      )}
                      <p>
                        <span className="font-medium text-foreground">Water goal:</span>{" "}
                        {src.waterGoalMl >= 1000 ? `${src.waterGoalMl / 1000}L` : `${src.waterGoalMl}ml`}
                      </p>
                    </div>
                  )
                })()}
              </CardContent>
            </Card>

            {/* Daily tags */}
            <Card>
              <CardContent className="pt-4 pb-4 px-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">🏷️ Tag today</p>
                <DailyTags />
              </CardContent>
            </Card>

            {/* Quick actions */}
            <div className="grid grid-cols-2 gap-2">
              <Link href="/dashboard/habits" className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium hover:bg-secondary/60 transition-colors active:scale-[0.97]">
                <span className="text-lg">✅</span> Habits
              </Link>
              <Link href="/dashboard/intake" className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium hover:bg-secondary/60 transition-colors active:scale-[0.97]">
                <span className="text-lg">💧</span> Intake
              </Link>
              <Link href="/dashboard/journal" className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium hover:bg-secondary/60 transition-colors active:scale-[0.97]">
                <span className="text-lg">📝</span> Journal
              </Link>
              <Link href="/dashboard" className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium hover:bg-secondary/60 transition-colors active:scale-[0.97]">
                <span className="text-lg">🏠</span> Dashboard
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
