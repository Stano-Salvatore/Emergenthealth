"use client"

import { useEffect, useState } from "react"
import { X, Sparkles } from "lucide-react"

const RELEASE_KEY = "whats_new_dismissed_v6"

const HIGHLIGHTS = [
  "🚀 Getting Started checklist — guided setup for new users",
  "📲 Install prompt — add app to home screen with one tap",
  "💬 Feedback button — send suggestions from anywhere",
  "🌍 Local timezone dates — no more wrong-day bugs for UTC+ users",
  "⚡ Habit Pro tier — unlimited habits + full streak history",
]

export function WhatsNewBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const dismissed = localStorage.getItem(RELEASE_KEY)
    if (!dismissed) setVisible(true)
  }, [])

  function dismiss() {
    localStorage.setItem(RELEASE_KEY, "1")
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-20 left-4 lg:left-auto lg:bottom-4 lg:right-4 z-40 w-72 rounded-2xl border border-primary/25 bg-background/95 backdrop-blur-md shadow-xl shadow-black/30 overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-border/50">
        <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-xs font-semibold text-primary flex-1">What&apos;s new in V6</span>
        <button
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="px-4 py-3 space-y-1.5">
        {HIGHLIGHTS.map((h) => (
          <p key={h} className="text-xs text-muted-foreground">{h}</p>
        ))}
      </div>
      <div className="px-4 pb-3">
        <button
          onClick={dismiss}
          className="text-[10px] text-primary/70 hover:text-primary transition-colors"
        >
          Got it, dismiss →
        </button>
      </div>
    </div>
  )
}
