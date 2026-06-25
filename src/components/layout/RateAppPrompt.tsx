"use client"

import { useEffect, useState } from "react"
import { X, Star } from "lucide-react"

const DISMISSED_KEY = "eh_rate_app_v1"
const FIRST_SEEN_KEY = "eh_first_seen"
const DAYS_BEFORE_PROMPT = 14

export function RateAppPrompt() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISSED_KEY)) return

      // Only show in standalone mode (installed PWA)
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true
      if (!standalone) return

      const firstSeen = localStorage.getItem(FIRST_SEEN_KEY)
      if (!firstSeen) return

      const daysSince = (Date.now() - parseInt(firstSeen)) / (1000 * 60 * 60 * 24)
      if (daysSince >= DAYS_BEFORE_PROMPT) setShow(true)
    } catch { /* */ }
  }, [])

  function dismiss() {
    try { localStorage.setItem(DISMISSED_KEY, "1") } catch { /* */ }
    setShow(false)
  }

  function openStore() {
    // Try Play Store deep link first, fall back to feedback form
    const ua = navigator.userAgent
    if (/android/i.test(ua)) {
      window.open("market://details?id=app.emergenthealth", "_blank")
    } else {
      // iOS App Store (placeholder) or feedback form
      window.open("https://emergenthealth.app", "_blank")
    }
    dismiss()
  }

  if (!show) return null

  return (
    <div className="fixed bottom-[170px] lg:bottom-[80px] left-4 right-4 lg:left-auto lg:right-6 lg:w-80 z-40">
      <div className="rounded-2xl border border-yellow-500/30 bg-card shadow-2xl shadow-black/40 overflow-hidden">
        <div className="flex items-start gap-3 p-4 pb-3">
          <div className="flex gap-0.5 shrink-0 mt-0.5">
            {[1,2,3,4,5].map(i => <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Enjoying Emergenthealth?</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              A quick rating helps others discover the app.
            </p>
          </div>
          <button onClick={dismiss} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex gap-2 px-4 pb-4">
          <button
            onClick={openStore}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-yellow-500/15 text-yellow-300 border border-yellow-500/30 py-2 text-xs font-semibold hover:bg-yellow-500/25 transition-colors"
          >
            <Star className="h-3.5 w-3.5" />
            Rate the app
          </button>
          <button
            onClick={dismiss}
            className="px-3 py-2 rounded-xl text-xs text-muted-foreground border border-border hover:bg-secondary/60 transition-colors"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  )
}
