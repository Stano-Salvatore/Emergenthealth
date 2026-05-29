"use client"

import { useEffect, useState } from "react"
import { Globe } from "lucide-react"

export function TimezoneDetector() {
  const [tz, setTz] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    setTz(detected)

    // Auto-save if not already saved
    fetch("/api/preferences/timezone")
      .then(r => r.json())
      .then(data => {
        if (!data.timezone) {
          fetch("/api/preferences/timezone", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ timezone: detected }),
          }).then(() => setSaved(true)).catch(() => {})
        } else {
          setSaved(true)
          setTz(data.timezone)
        }
      }).catch(() => {})
  }, [])

  if (!tz) return null

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Globe className="h-3.5 w-3.5 shrink-0" />
      <span>Notification timezone: <strong className="text-foreground">{tz}</strong></span>
      {!saved && <span className="text-muted-foreground/50">· saving…</span>}
    </div>
  )
}
