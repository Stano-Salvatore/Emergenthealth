"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import Link from "next/link"

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

  useEffect(() => {
    fetch("/api/morning-checkin")
      .then(r => r.json())
      .then(data => {
        if (data.checkin) {
          setExisting(data.checkin)
          setStep("done")
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function save(waterMl: number) {
    await fetch("/api/morning-checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        energy,
        mood,
        intention: intention.trim() || null,
        waterGoalMl: waterMl,
      }),
    })
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
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
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
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="pt-8 pb-6 px-6 text-center">
              <p className="text-4xl mb-3">✅</p>
              <p className="text-xl font-semibold mb-1">All set for today!</p>
              {existing ? (
                <div className="mt-4 space-y-1.5 text-sm text-muted-foreground text-left bg-background/60 rounded-xl px-4 py-3">
                  <p>
                    <span className="font-medium text-foreground">Energy:</span>{" "}
                    {ENERGY_OPTIONS.find(o => o.value === existing.energy)?.emoji}{" "}
                    {ENERGY_OPTIONS.find(o => o.value === existing.energy)?.label}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Mood:</span>{" "}
                    {MOOD_OPTIONS.find(o => o.value === existing.mood)?.emoji}{" "}
                    {MOOD_OPTIONS.find(o => o.value === existing.mood)?.label}
                  </p>
                  {existing.intention && (
                    <p>
                      <span className="font-medium text-foreground">Focus:</span>{" "}
                      {existing.intention}
                    </p>
                  )}
                  <p>
                    <span className="font-medium text-foreground">Water goal:</span>{" "}
                    {existing.waterGoalMl >= 1000 ? `${existing.waterGoalMl / 1000}L` : `${existing.waterGoalMl}ml`}
                  </p>
                </div>
              ) : (
                <div className="mt-4 space-y-1.5 text-sm text-muted-foreground text-left bg-background/60 rounded-xl px-4 py-3">
                  <p>
                    <span className="font-medium text-foreground">Energy:</span>{" "}
                    {ENERGY_OPTIONS.find(o => o.value === energy)?.emoji}{" "}
                    {ENERGY_OPTIONS.find(o => o.value === energy)?.label}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Mood:</span>{" "}
                    {MOOD_OPTIONS.find(o => o.value === mood)?.emoji}{" "}
                    {MOOD_OPTIONS.find(o => o.value === mood)?.label}
                  </p>
                  {intention.trim() && (
                    <p>
                      <span className="font-medium text-foreground">Focus:</span>{" "}
                      {intention.trim()}
                    </p>
                  )}
                  <p>
                    <span className="font-medium text-foreground">Water goal:</span>{" "}
                    {waterGoalMl >= 1000 ? `${waterGoalMl / 1000}L` : `${waterGoalMl}ml`}
                  </p>
                </div>
              )}
              <Link
                href="/dashboard"
                className="mt-6 inline-block text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Back to dashboard
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
