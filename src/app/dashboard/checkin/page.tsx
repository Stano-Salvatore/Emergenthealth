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

export default function CheckInPage() {
  const [step, setStep] = useState<0 | 1 | 2 | 3 | "done">(0)
  const [energy, setEnergy] = useState<number | null>(null)
  const [mood, setMood] = useState<number | null>(null)
  const [intention, setIntention] = useState("")
  const [waterGoalMl, setWaterGoalMl] = useState<number>(2000)
  const [existing, setExisting] = useState<CheckIn | null>(null)
  const [loading, setLoading] = useState(true)

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

  function progressDots() {
    const current = step === "done" ? 4 : (step as number)
    return (
      <div className="flex items-center justify-center gap-2 mb-8">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            className={`rounded-full transition-all ${
              i < current
                ? "h-2 w-2 bg-violet-500"
                : i === current
                ? "h-2.5 w-2.5 bg-violet-400 ring-2 ring-violet-400/30"
                : "h-2 w-2 bg-muted"
            }`}
          />
        ))}
        <span className="text-xs text-muted-foreground ml-2">
          {step === "done" ? "Done" : `Step ${(step as number) + 1} of 4`}
        </span>
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
        {step !== "done" && progressDots()}

        {step === 0 && (
          <Card>
            <CardContent className="pt-8 pb-6 px-6">
              <p className="text-center text-xl font-semibold mb-6">How&apos;s your energy?</p>
              <div className="grid grid-cols-5 gap-2">
                {ENERGY_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setEnergy(opt.value); setStep(1) }}
                    className="flex flex-col items-center gap-1.5 rounded-xl border border-border p-3 min-h-[72px] hover:border-violet-500/50 hover:bg-violet-500/5 transition-all active:scale-95"
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
                    onClick={() => { setMood(opt.value); setStep(2) }}
                    className="flex flex-col items-center gap-1.5 rounded-xl border border-border p-3 min-h-[72px] hover:border-violet-500/50 hover:bg-violet-500/5 transition-all active:scale-95"
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
                    className="flex flex-col items-center justify-center rounded-xl border border-border py-4 min-h-[72px] text-lg font-bold hover:border-violet-500/50 hover:bg-violet-500/5 transition-all active:scale-95"
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
          <Card className="border-violet-500/30 bg-violet-500/5">
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
