"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const TOTAL_STEPS = 5

// ── Step indicator ────────────────────────────────────────────────────────────
function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`block rounded-full transition-all duration-300 ${
            i < current
              ? "w-2 h-2 bg-primary"
              : i === current
              ? "w-4 h-2 bg-primary"
              : "w-2 h-2 bg-border"
          }`}
        />
      ))}
    </div>
  )
}

// ── Category card ─────────────────────────────────────────────────────────────
interface Category {
  emoji: string
  name: string
  description: string
  id: string
}

const CATEGORIES: Category[] = [
  { id: "sleep", emoji: "😴", name: "Sleep", description: "Track sleep quality and duration" },
  { id: "fitness", emoji: "🏃", name: "Fitness", description: "Steps, activities, workouts" },
  { id: "productivity", emoji: "🧠", name: "Productivity", description: "Focus time, tasks, coding" },
  { id: "finances", emoji: "💰", name: "Finances", description: "Spending, budgets, trends" },
  { id: "mood", emoji: "😊", name: "Mood", description: "Daily mood and energy" },
  { id: "reading", emoji: "📖", name: "Reading", description: "Books and learning" },
]

function CategoryCard({
  category,
  selected,
  onToggle,
}: {
  category: Category
  selected: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className={`rounded-xl border p-4 text-left cursor-pointer transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        selected
          ? "border-primary bg-primary/10"
          : "border-border hover:border-primary/50 bg-card"
      }`}
    >
      <div className="text-2xl mb-2">{category.emoji}</div>
      <div className="font-medium text-foreground text-sm">{category.name}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{category.description}</div>
    </button>
  )
}

// ── Integration card ──────────────────────────────────────────────────────────
interface Integration {
  emoji: string
  name: string
  description: string
}

const INTEGRATIONS: Integration[] = [
  { emoji: "💍", name: "Oura Ring", description: "Sleep & HRV tracking" },
  { emoji: "📅", name: "Google Calendar", description: "Schedule context" },
  { emoji: "🚴", name: "Strava", description: "Workouts & activities" },
  { emoji: "💳", name: "YNAB", description: "Spending & budgets" },
  { emoji: "🎵", name: "Last.fm", description: "Music listening" },
  { emoji: "⏱️", name: "RescueTime", description: "Focus & productivity" },
]

function IntegrationCard({ integration }: { integration: Integration }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <span className="text-xl shrink-0">{integration.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-foreground text-sm">{integration.name}</div>
        <div className="text-xs text-muted-foreground">{integration.description}</div>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground border border-border rounded-md px-2 py-1 whitespace-nowrap">
        Connect in Settings →
      </span>
    </div>
  )
}

// ── Preset goals ──────────────────────────────────────────────────────────────
const PRESET_GOALS = [
  "Sleep 7+ hours per night",
  "Walk 8,000 steps daily",
  "Complete habits 80% of the time",
]

// ── Main wizard ───────────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set())
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null)
  const [customGoal, setCustomGoal] = useState("")
  const [finishing, setFinishing] = useState(false)

  function toggleCategory(id: string) {
    setSelectedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function finish() {
    if (finishing) return
    setFinishing(true)
    try {
      const ref = typeof window !== "undefined" ? localStorage.getItem("eh_referral_code") : null
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true, ref: ref ?? undefined }),
      })
      if (ref) localStorage.removeItem("eh_referral_code")
    } catch {
      // non-fatal — still redirect
    }
    router.push("/dashboard")
  }

  return (
    <div className="w-full max-w-lg">
      <div className="rounded-2xl bg-card border border-border p-8">
        <StepDots current={step} total={TOTAL_STEPS} />

        {/* ── Step 0: Welcome ───────────────────────────────── */}
        {step === 0 && (
          <div>
            <div className="text-4xl mb-4">✨</div>
            <h1 className="text-2xl font-bold text-foreground mb-2">
              Welcome to Emergenthealth
            </h1>
            <p className="text-muted-foreground mb-8 leading-relaxed">
              Your personal health command center. Let&apos;s set it up in 2 minutes.
            </p>
            <div className="flex flex-col gap-3">
              <Button
                className="w-full"
                size="lg"
                onClick={() => setStep(1)}
              >
                Get started →
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="w-full text-muted-foreground"
                asChild
              >
                <Link href="/dashboard">Skip setup, take me to the dashboard</Link>
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 1: Category picker ───────────────────────── */}
        {step === 1 && (
          <div>
            <h2 className="text-xl font-bold text-foreground mb-1">
              What matters most to you?
            </h2>
            <p className="text-muted-foreground text-sm mb-6">
              We&apos;ll prioritize these on your dashboard.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-8">
              {CATEGORIES.map((cat) => (
                <CategoryCard
                  key={cat.id}
                  category={cat}
                  selected={selectedCategories.has(cat.id)}
                  onToggle={() => toggleCategory(cat.id)}
                />
              ))}
            </div>
            <Button className="w-full" size="lg" onClick={() => setStep(2)}>
              Continue →
            </Button>
          </div>
        )}

        {/* ── Step 2: Integrations ──────────────────────────── */}
        {step === 2 && (
          <div>
            <h2 className="text-xl font-bold text-foreground mb-1">Connect your apps</h2>
            <p className="text-muted-foreground text-sm mb-6">
              The more you connect, the smarter your insights.
            </p>
            <div className="flex flex-col gap-2 mb-8">
              {INTEGRATIONS.map((integration) => (
                <IntegrationCard key={integration.name} integration={integration} />
              ))}
            </div>
            <Button className="w-full" size="lg" onClick={() => setStep(3)}>
              Continue →
            </Button>
          </div>
        )}

        {/* ── Step 3: Goal ─────────────────────────────────── */}
        {step === 3 && (
          <div>
            <h2 className="text-xl font-bold text-foreground mb-1">Set your first goal</h2>
            <p className="text-muted-foreground text-sm mb-6">
              Goals appear on your dashboard so you can track progress.
            </p>
            <div className="flex flex-col gap-2 mb-4">
              {PRESET_GOALS.map((goal) => (
                <button
                  key={goal}
                  onClick={() => {
                    setSelectedGoal(goal === selectedGoal ? null : goal)
                    setCustomGoal("")
                  }}
                  className={`rounded-xl border px-4 py-3 text-left text-sm font-medium cursor-pointer transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    selectedGoal === goal
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card text-foreground hover:border-primary/50"
                  }`}
                >
                  {goal}
                </button>
              ))}
            </div>
            <Input
              placeholder="Or type your own…"
              value={customGoal}
              onChange={(e) => {
                setCustomGoal(e.target.value)
                if (e.target.value) setSelectedGoal(null)
              }}
              className="mb-8"
            />
            <div className="flex flex-col gap-3">
              <Button className="w-full" size="lg" onClick={() => setStep(4)}>
                Finish setup →
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="w-full text-muted-foreground"
                onClick={() => setStep(4)}
              >
                Skip for now
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 4: Done ─────────────────────────────────── */}
        {step === 4 && (
          <div>
            <div className="text-center mb-6">
              <div className="text-5xl mb-4">🎉</div>
              <h2 className="text-2xl font-bold text-foreground mb-2">You&apos;re all set!</h2>
              <p className="text-muted-foreground leading-relaxed">
                Your dashboard is ready. Here&apos;s what to do first:
              </p>
            </div>

            <div className="rounded-xl border border-border/60 divide-y divide-border/40 mb-8">
              {[
                { emoji: "🌅", label: "Log your morning check-in", href: "/dashboard/checkin", hint: "Energy, mood, intention" },
                { emoji: "🔗", label: "Connect Oura Ring or Strava", href: "/dashboard/settings", hint: "Auto-sync health & activity data" },
                { emoji: "✅", label: "Create your first habit", href: "/dashboard/habits", hint: "Build streaks and earn XP" },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/40 transition-colors"
                >
                  <span className="text-xl shrink-0">{item.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.hint}</p>
                  </div>
                  <span className="text-muted-foreground/40 text-sm">→</span>
                </Link>
              ))}
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={finish}
              disabled={finishing}
            >
              {finishing ? "Heading to your dashboard…" : "Go to dashboard →"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
