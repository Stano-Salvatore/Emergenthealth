"use client"

// Samsung-style morning brief: the first time the app is opened in the
// morning, the day's brief comes to the user instead of waiting on the Brief
// tab. Shows at most once per calendar day, and only in the morning window —
// open the app at 20:00 and nothing pops.

import { useEffect, useState, useCallback } from "react"
import { usePathname } from "next/navigation"
import { X } from "lucide-react"
import { BriefView } from "./BriefView"

const LAST_SHOWN_KEY = "morning_brief_last"
const DISABLED_KEY = "morning_brief_off"
const START_HOUR = 4
const END_HOUR = 12 // exclusive — 04:00–11:59 counts as morning

function localDateStr(d = new Date()): string {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-")
}

export function MorningBriefPopup({ name }: { name: string }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  // The Brief page already *is* this content — popping it over itself just
  // shows the same brief twice, stacked.
  const onBriefPage = pathname === "/dashboard/brief"

  const maybeOpen = useCallback(() => {
    try {
      if (onBriefPage) return
      if (localStorage.getItem(DISABLED_KEY) === "1") return
      const hour = new Date().getHours()
      if (hour < START_HOUR || hour >= END_HOUR) return
      if (localStorage.getItem(LAST_SHOWN_KEY) === localDateStr()) return
      localStorage.setItem(LAST_SHOWN_KEY, localDateStr())
      setOpen(true)
    } catch { /* private mode — just don't show it */ }
  }, [onBriefPage])

  useEffect(() => {
    // A frame later, not during the effect: the dashboard gets to paint before
    // a full-screen sheet lands on top of it, which is also what stops this
    // from being a render cascade on every mount.
    const t = setTimeout(maybeOpen, 0)
    // The phone app is resumed far more often than cold-started: someone who
    // left it open overnight should still get the brief when they pick it up.
    const onVisible = () => { if (document.visibilityState === "visible") maybeOpen() }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearTimeout(t)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [maybeOpen])

  // Escape to dismiss, and don't let the page scroll behind the sheet
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  function turnOff() {
    try { localStorage.setItem(DISABLED_KEY, "1") } catch {}
    setOpen(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Morning brief"
        className="relative w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[85vh] flex flex-col rounded-t-3xl sm:rounded-3xl border border-border bg-background shadow-2xl"
        style={{ animation: "briefIn 0.28s cubic-bezier(0.2,0.8,0.2,1)" }}
      >
        <style>{`
          @keyframes briefIn {
            from { opacity: 0; transform: translateY(24px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>

        {/* Drag handle (mobile affordance) + close */}
        <div className="shrink-0 flex items-center gap-2 px-4 pt-3 pb-2">
          <div className="flex-1 flex justify-center sm:hidden">
            <div className="h-1 w-10 rounded-full bg-border" />
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close brief"
            className="absolute right-3 top-3 h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-2">
          <BriefView name={name} />
        </div>

        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-t border-border/60"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
          <button
            onClick={turnOff}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Don&apos;t show automatically
          </button>
          <button
            onClick={() => setOpen(false)}
            className="ml-auto rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Start my day →
          </button>
        </div>
      </div>
    </div>
  )
}
