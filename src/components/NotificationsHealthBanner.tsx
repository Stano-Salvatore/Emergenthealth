"use client"

/**
 * Tells the user when this phone cannot deliver notifications, instead of
 * letting reminders fail silently. Everything the app schedules is a native
 * local notification, so if the permission is missing or the APK predates the
 * notifications plugin, every reminder, habit and dose nudge dies without a
 * trace — the only symptom is silence. This banner is the trace.
 *
 * Native app only, and only for a broken chain: permission granted and
 * notifications scheduled renders nothing. Dismissing snoozes it for a week
 * rather than forever — a phone that still can't notify is worth re-raising.
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { BellOff, X } from "lucide-react"
import { isNativeApp } from "@/lib/native/geolocation"
import { getNotificationPermission, getScheduledStatus, nudgesEnabled } from "@/lib/native/notifications"

const SNOOZE_KEY = "notif_banner_snoozed_until"
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

type Problem = "permission" | "unavailable" | "none-scheduled"

const MESSAGES: Record<Problem, { title: string; body: string }> = {
  permission: {
    title: "Notifications are off",
    body: "Reminders, habits and medication nudges can't reach this phone until you allow notifications.",
  },
  unavailable: {
    title: "This app version can't send notifications",
    body: "Update the Emergenthealth app — this build is missing the notifications plugin, so no reminder will fire.",
  },
  "none-scheduled": {
    title: "No notifications are scheduled",
    body: "Notifications are allowed but nothing is queued on this phone, so nothing will buzz. Open Settings to resync.",
  },
}

export function NotificationsHealthBanner() {
  const [problem, setProblem] = useState<Problem | null>(null)

  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        if (Date.now() < Number(localStorage.getItem(SNOOZE_KEY) ?? 0)) return
        if (!(await isNativeApp())) return
        // Give NativeBridge's resync (kicked off on the same mount) time to
        // prompt for permission and lay notifications down, so a fresh app
        // open isn't misread as a broken one.
        await new Promise(r => setTimeout(r, 8000))
        if (cancelled) return
        const perm = await getNotificationPermission()
        let found: Problem | null = null
        if (perm === "unavailable") found = "unavailable"
        else if (perm === "denied" || perm === "prompt") found = "permission"
        else if (nudgesEnabled()) {
          // With nudges on, at least the repeating dailies must be queued —
          // an empty queue means scheduling is broken. With nudges off, an
          // empty queue is exactly what the user asked for: say nothing.
          // Only a definite answer counts; a timed-out getPending isn't
          // evidence of a problem.
          const status = await getScheduledStatus()
          if (status.available && status.pending === 0) found = "none-scheduled"
        }
        // Also clears an earlier banner once the user has fixed the cause —
        // e.g. granted the permission prompt after this ran, then tabbed back.
        if (!cancelled) setProblem(found)
      } catch {
        // Diagnostics must never break the dashboard.
      }
    }
    check()
    const recheck = () => { if (document.visibilityState === "visible") check() }
    document.addEventListener("visibilitychange", recheck)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", recheck)
    }
  }, [])

  if (!problem) return null
  const msg = MESSAGES[problem]

  function dismiss() {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS))
    } catch { /* ignore */ }
    setProblem(null)
  }

  return (
    <div className="fixed top-2 left-2 right-2 z-40 lg:left-auto lg:w-96">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 backdrop-blur-md px-3 py-2.5 shadow-lg flex items-start gap-2.5">
        <BellOff className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-amber-400">{msg.title}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{msg.body}</p>
          <Link
            href="/dashboard/settings"
            onClick={() => setProblem(null)}
            className="inline-block text-[11px] font-medium text-amber-400 underline underline-offset-2 mt-1"
          >
            Fix in Settings
          </Link>
        </div>
        <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
