"use client"

import { useCallback, useEffect, useState } from "react"
import { Activity } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  sensorStatus, startSleepTracking, stopSleepTracking, type SensorStatus,
} from "@/lib/native/bubble"
import { uploadPhoneSensors } from "@/lib/native/phone-uploads"

// The phone as an instrument, rather than as a thing that carries the app.
//
// Four signals, and the reason they are worth having is that between them they
// cost NO permission the app did not already hold:
//
//   Light and pressure come off sensors any app may read. Light against how
//   long it took to fall asleep is the pairing worth the whole card; pressure
//   is the weather cron's number measured where the person actually is.
//
//   Screen and charge moments need nothing either, and they are the honest
//   half of what screen time was wanted for — bedtime, waking, pickups —
//   without PACKAGE_USAGE_STATS, which COMPLIANCE.md says not to declare.
//
//   The Sleep API runs on the motion permission already granted for travel
//   modes, and fills the nights the ring was not worn.
//
// What this card must not do is imply more than the phone gives. A phone with
// no barometer says so. The screen receiver only collects while a foreground
// service is alive, and that is stated rather than glossed — a card that
// promised continuous collection and delivered gaps would be the "remedy that
// isn't rendered" again.

export function PhoneSensorsCard() {
  const [status, setStatus] = useState<SensorStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setStatus(await sensorStatus())
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // Opening this card is itself a reading, and a chance to send the backlog
  // — the same upload NativeBridge runs on every foreground, so the queue
  // counts shown below are what is left AFTER a send, not a backlog waiting
  // for someone to open Settings.
  useEffect(() => {
    let cancelled = false
    async function pull() {
      const sent = await uploadPhoneSensors()
      if (cancelled || sent === 0) return
      await refresh()
    }
    void pull()
    return () => { cancelled = true }
  }, [refresh])

  async function enableSleep() {
    setBusy(true)
    setNote(null)
    try {
      setNote(await startSleepTracking())
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function disableSleep() {
    setBusy(true)
    try {
      await stopSleepTracking()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  // Web, or an APK older than this feature. Nothing here would work, so
  // nothing here is shown.
  if (!status) return null

  const hasAnySensor = status.light || status.pressure

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Activity className="h-3.5 w-3.5" /> What the phone itself can measure
        </p>
        <p className="mb-3 text-xs text-muted-foreground">
          Readings your phone already takes and nothing was using. None of this asks for a
          new permission.
        </p>

        <dl className="mb-3 space-y-1.5 text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Light</dt>
            <dd className={status.light ? "text-emerald-400" : "text-muted-foreground"}>
              {status.light
                ? "Reading — how bright it is around you in the evening"
                : "This phone has no light sensor"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Pressure</dt>
            <dd className={status.pressure ? "text-emerald-400" : "text-muted-foreground"}>
              {status.pressure
                ? "Reading — air pressure where you actually are"
                : "This phone has no barometer"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Screen &amp; charging</dt>
            <dd className={status.phoneEventsHosted ? "text-emerald-400" : "text-amber-400"}>
              {status.phoneEventsHosted
                ? "Recording when you put the phone down and pick it up"
                : "Paused — needs location or the wake word switched on"}
            </dd>
          </div>
        </dl>

        {hasAnySensor && (
          <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
            Light is read when the phone is awake, so a pocket reads as darkness — it says
            how much light was around when the phone could see, not how much reached you.
          </p>
        )}

        <div className="border-t border-border/60 pt-3">
          <p className="mb-1.5 text-xs font-medium">Sleep, when the ring is off</p>
          <p className="mb-2 text-xs text-muted-foreground">
            The phone can guess when you slept. It is worse than the ring in every way and
            never overwrites it — it is for the nights the ring was on the charger, which
            currently read as though you did not sleep at all.
          </p>

          {!status.sleepPermitted ? (
            <p className="text-xs text-muted-foreground">
              Needs the motion permission — turn on motion labelling above first.
            </p>
          ) : status.sleepTracking ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-emerald-400">
                On — segments arrive each morning.
                {status.queuedSleep > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    {status.queuedSleep} segment{status.queuedSleep === 1 ? "" : "s"} on the phone, uploading on this visit.
                  </span>
                )}
              </span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={disableSleep}>
                Turn off
              </Button>
            </div>
          ) : (
            <Button size="sm" disabled={busy} onClick={enableSleep}>
              {busy ? "…" : "Let the phone detect sleep"}
            </Button>
          )}
        </div>

        {note && <p className="mt-2 text-xs text-amber-400">{note}</p>}
      </CardContent>
    </Card>
  )
}
