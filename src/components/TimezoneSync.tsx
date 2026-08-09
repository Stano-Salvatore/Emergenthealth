"use client"

import { useEffect } from "react"

// The stored timezone decides which day a habit tick belongs to and when a
// reminder is due — the server runs on UTC and cannot work either out on its
// own. It used to be written only by the Settings page, so anyone who never
// opened Settings silently fell back to UTC: streaks rolled over at the wrong
// hour and reminders fired at the wrong time. Detection belongs everywhere the
// app is open, so this is mounted in the dashboard layout.
//
// It also re-syncs when the zone changes, which keeps reminders honest across
// travel and daylight-saving moves.

const CACHE_KEY = "tz_synced"

export function TimezoneSync() {
  useEffect(() => {
    let detected: string
    try {
      detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return
    }
    if (!detected) return

    // Already confirmed for this zone — skip the round trip.
    try {
      if (localStorage.getItem(CACHE_KEY) === detected) return
    } catch { /* private mode — just do the request */ }

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/preferences/timezone")
        const data = res.ok ? await res.json() : {}
        if (cancelled) return
        if (data.timezone !== detected) {
          await fetch("/api/preferences/timezone", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ timezone: detected }),
          })
        }
        try { localStorage.setItem(CACHE_KEY, detected) } catch { /* ignore */ }
      } catch { /* offline — try again next load */ }
    })()

    return () => { cancelled = true }
  }, [])

  return null
}
