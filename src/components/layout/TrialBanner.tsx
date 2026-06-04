"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { X, Zap, Sparkles } from "lucide-react"

const DISMISS_KEY_FREE = "trial_banner_free_v1"
const DISMISS_KEY_TRIAL = "trial_banner_trial_v1"
const FIRST_SEEN_KEY = "eh_first_seen"

interface PlanStatus {
  plan: "free" | "pro"
  isTrialing: boolean
  trialDaysLeft: number | null
  cancelAtPeriodEnd: boolean
}

export function TrialBanner() {
  const [status, setStatus] = useState<PlanStatus | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Track first seen date
    if (!localStorage.getItem(FIRST_SEEN_KEY)) {
      localStorage.setItem(FIRST_SEEN_KEY, String(Date.now()))
    }

    fetch("/api/user/plan")
      .then(r => r.json())
      .then((data: PlanStatus) => {
        setStatus(data)

        if (data.plan === "pro" && !data.isTrialing) return

        if (data.isTrialing && data.trialDaysLeft !== null && data.trialDaysLeft <= 4) {
          // Show trial expiry warning if not dismissed for this period
          const key = `${DISMISS_KEY_TRIAL}_${data.trialDaysLeft}`
          if (!localStorage.getItem(key)) setVisible(true)
          return
        }

        if (data.plan === "free") {
          // Show free nudge after 5 days of use, once per week
          const firstSeen = parseInt(localStorage.getItem(FIRST_SEEN_KEY) ?? "0", 10)
          const daysSince = (Date.now() - firstSeen) / (1000 * 60 * 60 * 24)
          if (daysSince < 5) return
          const dismissed = parseInt(localStorage.getItem(DISMISS_KEY_FREE) ?? "0", 10)
          const daysSinceDismiss = (Date.now() - dismissed) / (1000 * 60 * 60 * 24)
          if (!dismissed || daysSinceDismiss > 7) setVisible(true)
        }
      })
      .catch(() => {})
  }, [])

  function dismiss() {
    setVisible(false)
    if (status?.isTrialing) {
      localStorage.setItem(`${DISMISS_KEY_TRIAL}_${status.trialDaysLeft}`, "1")
    } else {
      localStorage.setItem(DISMISS_KEY_FREE, String(Date.now()))
    }
  }

  if (!visible || !status) return null

  const isTrialExpiring = status.isTrialing && status.trialDaysLeft !== null && status.trialDaysLeft <= 4

  return (
    <div className={`fixed top-0 inset-x-0 z-40 flex items-center justify-between gap-3 px-4 py-2.5 text-sm ${
      isTrialExpiring
        ? "bg-amber-500/15 border-b border-amber-500/30 text-amber-200"
        : "bg-primary/10 border-b border-primary/20 text-foreground"
    }`}>
      <div className="flex items-center gap-2 min-w-0">
        {isTrialExpiring ? (
          <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        ) : (
          <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
        )}
        <span className="truncate text-xs">
          {isTrialExpiring
            ? `Your Pro trial ends in ${status.trialDaysLeft} day${status.trialDaysLeft === 1 ? "" : "s"}. Add payment to keep Pro.`
            : "Enjoying Emergenthealth? Unlock unlimited habits, full history & daily AI insights with Pro."}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="/pricing"
          onClick={dismiss}
          className={`text-xs font-semibold transition-colors ${
            isTrialExpiring ? "text-amber-300 hover:text-amber-100" : "text-primary hover:text-primary/80"
          }`}
        >
          {isTrialExpiring ? "Add payment →" : "Upgrade →"}
        </Link>
        <button onClick={dismiss} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
