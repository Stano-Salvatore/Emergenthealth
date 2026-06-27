"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Bell } from "lucide-react"
import { isNativeApp } from "@/lib/native/geolocation"
import { nudgesEnabled, setNudgesEnabled, resyncNotifications } from "@/lib/native/notifications"

export function NotificationNudges() {
  const [inApp, setInApp] = useState(false)
  const [on, setOn] = useState(true)

  useEffect(() => {
    isNativeApp().then(native => {
      setInApp(native)
      if (native) setOn(nudgesEnabled())
    })
  }, [])

  // Native-only — the web build can't fire local notifications.
  if (!inApp) return null

  async function toggle() {
    const next = !on
    setOn(next)
    setNudgesEnabled(next)
    await resyncNotifications()
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bell className="h-4 w-4" /> Daily Nudges
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Gentle daily reminders on your phone — morning check-in (08:00), hydration (13:00),
            and habits (20:00).
          </p>
          <button
            onClick={toggle}
            role="switch"
            aria-checked={on}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-secondary"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`}
            />
          </button>
        </div>
      </CardContent>
    </Card>
  )
}
