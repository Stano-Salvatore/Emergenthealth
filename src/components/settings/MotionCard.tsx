"use client"

import { useCallback, useEffect, useState } from "react"
import { Footprints } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  activityStatus, drainActivityEvents, requestActivityPermission,
  startActivityTracking, stopActivityTracking, type ActivityStatus,
} from "@/lib/native/bubble"

// Let the phone name the mode instead of guessing it from speed.
//
// Android's Activity Recognition fuses the accelerometer, gyroscope and step
// counter — not the raw gyroscope, which on its own says nothing — into
// walking / running / cycling / in-a-vehicle. On the days this app tracks
// your location itself, that turns the journey view's travel modes from
// speed guesses into what the phone actually detected. A Timeline import
// already brings Google's own labels for the past; this covers the present.
//
// One permission, requested here and never at launch, and it still cannot
// tell a bus from a car — both are "in a vehicle" — so those stay a guess,
// refined rather than asserted.

export function MotionCard() {
  const [status, setStatus] = useState<ActivityStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setStatus(await activityStatus())
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // Drain whatever the phone recorded while the app was closed, whenever this
  // card is on screen — the same store-and-forward the head and the location
  // queue use. Harmless on web, where the drain returns nothing.
  useEffect(() => {
    let cancelled = false
    async function pull() {
      const events = await drainActivityEvents()
      if (cancelled || events.length === 0) return
      await fetch("/api/activity/transitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events }),
      }).catch(() => null)
    }
    void pull()
    return () => { cancelled = true }
  }, [])

  async function enable() {
    setBusy(true)
    setNote(null)
    try {
      const granted = await requestActivityPermission()
      if (!granted) {
        setNote("Motion permission was declined. You can grant it later under the app's Physical activity permission.")
        return
      }
      const err = await startActivityTracking()
      setNote(err)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    try {
      await stopActivityTracking()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  // Web, or an APK older than this feature: the card would only mislead, so
  // it stays hidden rather than offering a button that does nothing.
  if (status && !status.available) return null

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Footprints className="h-3.5 w-3.5" /> Motion from the phone
        </p>
        <p className="mb-3 text-xs text-muted-foreground">
          Let the phone label how you travelled — walking, running, cycling, in a vehicle —
          so the day journey stops guessing it from speed. One permission; it never runs
          without you turning it on, and it can&apos;t tell a bus from a car.
        </p>

        {status?.tracking ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-emerald-400">On — the phone is labelling your movement.</span>
            <Button size="sm" variant="ghost" disabled={busy} onClick={disable}>Turn off</Button>
          </div>
        ) : (
          <Button size="sm" disabled={busy} onClick={enable}>
            {busy ? "…" : "Turn on motion labelling"}
          </Button>
        )}

        {note && <p className="mt-2 text-xs text-amber-400">{note}</p>}
      </CardContent>
    </Card>
  )
}
