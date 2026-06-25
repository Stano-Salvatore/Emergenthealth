"use client"

import { useEffect, useState } from "react"
import { X, Share2, Star } from "lucide-react"

const FIRST_SEEN_KEY = "eh_first_seen"
const DISMISSED_KEY = "eh_share_prompt_v1"
const DAYS_BEFORE_PROMPT = 7

export function AppSharePrompt() {
  const [show, setShow] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    try {
      // Don't show again if dismissed
      if (localStorage.getItem(DISMISSED_KEY)) return

      // Record first-seen timestamp if not yet set
      const firstSeen = localStorage.getItem(FIRST_SEEN_KEY)
      if (!firstSeen) {
        localStorage.setItem(FIRST_SEEN_KEY, String(Date.now()))
        return
      }

      const daysSince = (Date.now() - parseInt(firstSeen)) / (1000 * 60 * 60 * 24)
      if (daysSince >= DAYS_BEFORE_PROMPT) setShow(true)
    } catch { /* */ }
  }, [])

  function dismiss() {
    try { localStorage.setItem(DISMISSED_KEY, "1") } catch { /* */ }
    setShow(false)
  }

  async function share() {
    // Try to use personal invite URL, fall back to homepage
    let url = "https://emergenthealth.app"
    try {
      const r = await fetch("/api/invite")
      if (r.ok) { const d = await r.json(); if (d.inviteUrl) url = d.inviteUrl }
    } catch { /* */ }
    const text = "I've been using Emergenthealth to track my health, habits & finances — check it out!"

    if (navigator.share) {
      try {
        await navigator.share({ title: "Emergenthealth", text, url })
        dismiss()
        return
      } catch { /* user cancelled */ }
    }

    // Fallback: copy link
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => { setCopied(false); dismiss() }, 2000)
    } catch { /* */ }
  }

  if (!show) return null

  return (
    <div className="fixed bottom-[168px] lg:bottom-20 right-4 lg:right-6 z-40 w-72 rounded-2xl border border-border bg-card shadow-xl shadow-black/30 overflow-hidden">
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <Star className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight">Enjoying Emergenthealth?</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Share it with a friend who wants to level up their health.
          </p>
        </div>
        <button
          onClick={dismiss}
          className="text-muted-foreground/50 hover:text-muted-foreground transition-colors shrink-0 mt-0.5"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-2 px-4 pb-4">
        <button
          onClick={share}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-medium text-white hover:bg-primary/90 transition-colors active:scale-95"
        >
          <Share2 className="h-3.5 w-3.5" />
          {copied ? "Link copied!" : "Share app"}
        </button>
        <button
          onClick={dismiss}
          className="px-3 py-2 rounded-xl text-xs text-muted-foreground border border-border hover:bg-secondary/60 transition-colors"
        >
          Not now
        </button>
      </div>
    </div>
  )
}
