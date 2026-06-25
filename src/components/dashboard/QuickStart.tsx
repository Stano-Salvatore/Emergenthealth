"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import { X, Rocket, ChevronRight } from "lucide-react"

const DISMISS_KEY = "quickstart_dismissed_v1"
const FIRST_SEEN_KEY = "eh_first_seen"
const SHOW_DAYS = 14

interface Step {
  id: string
  emoji: string
  title: string
  desc: string
  href: string
  done?: boolean
}

function CheckItem({ step }: { step: Step }) {
  return (
    <Link href={step.href} className="flex items-start gap-3 group py-2.5 border-b border-border/50 last:border-0">
      <div className={`mt-0.5 shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${
        step.done ? "bg-green-500 border-green-500" : "border-border group-hover:border-primary"
      }`}>
        {step.done && <span className="text-[10px] text-white font-bold">✓</span>}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium leading-tight ${step.done ? "line-through text-muted-foreground" : ""}`}>
          {step.emoji} {step.title}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{step.desc}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5 group-hover:translate-x-0.5 transition-transform" />
    </Link>
  )
}

export function QuickStart({ hasCheckin, hasHabits, hasPush }: {
  hasCheckin: boolean
  hasHabits: boolean
  hasPush?: boolean
}) {
  const [visible, setVisible] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(hasPush ?? false)

  useEffect(() => {
    const dismissed = localStorage.getItem(DISMISS_KEY)
    if (dismissed) return

    // Track first seen
    if (!localStorage.getItem(FIRST_SEEN_KEY)) {
      localStorage.setItem(FIRST_SEEN_KEY, String(Date.now()))
    }

    const firstSeen = parseInt(localStorage.getItem(FIRST_SEEN_KEY) ?? "0", 10)
    const daysSince = (Date.now() - firstSeen) / (1000 * 60 * 60 * 24)
    if (daysSince <= SHOW_DAYS) setVisible(true)

    // Check push subscription status
    if ("serviceWorker" in navigator && "PushManager" in window) {
      navigator.serviceWorker.ready
        .then(reg => reg.pushManager.getSubscription())
        .then(sub => setPushEnabled(!!sub))
        .catch(() => {})
    }
  }, [])

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1")
    setVisible(false)
  }

  if (!visible) return null

  const steps: Step[] = [
    {
      id: "checkin",
      emoji: "🌅",
      title: "Do your morning check-in",
      desc: "Log your energy, mood, and daily intention",
      href: "/dashboard/checkin",
      done: hasCheckin,
    },
    {
      id: "habits",
      emoji: "✅",
      title: "Add your first habits",
      desc: "Set 3-5 daily habits to track",
      href: "/dashboard/habits",
      done: hasHabits,
    },
    {
      id: "push",
      emoji: "🔔",
      title: "Enable push notifications",
      desc: "Get morning reminders and stay on track",
      href: "/dashboard/settings",
      done: pushEnabled,
    },
    {
      id: "chat",
      emoji: "🌱",
      title: "Say hi to Emergy",
      desc: "Your AI companion — ask for a morning briefing",
      href: "/dashboard/chat",
    },
    {
      id: "goals",
      emoji: "🎯",
      title: "Set your health goals",
      desc: "Customize sleep, steps, and water targets",
      href: "/dashboard/settings#goals",
    },
  ]

  const doneCount = steps.filter(s => s.done).length
  const allDone = doneCount === steps.length

  if (allDone) {
    dismiss()
    return null
  }

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-card">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Rocket className="h-4 w-4 text-primary" />
            Getting started
            <span className="text-xs font-normal text-muted-foreground ml-1">
              {doneCount}/{steps.length} done
            </span>
          </CardTitle>
          <button
            onClick={dismiss}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="h-1 rounded-full bg-secondary overflow-hidden mt-1">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${(doneCount / steps.length) * 100}%`,
              background: "linear-gradient(90deg, var(--primary), color-mix(in srgb, var(--primary) 70%, #fff))",
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="pt-1 pb-3">
        {steps.map(step => (
          <CheckItem key={step.id} step={step} />
        ))}
      </CardContent>
    </Card>
  )
}
