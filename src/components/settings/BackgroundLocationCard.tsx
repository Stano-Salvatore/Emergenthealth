"use client"

import { useCallback, useEffect, useState } from "react"
import { MapPin, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  isBackgroundLocationAvailable,
  isBackgroundLocationEnabled,
  openLocationSettings,
  startBackgroundLocation,
  stopBackgroundLocation,
} from "@/lib/native/background-location"

/**
 * The one switch that makes place check-ins happen by themselves.
 *
 * Everything behind it already worked from OwnTracks or a Timeline import —
 * this just lets the app supply its own points, so there is no second app to
 * install and no export to remember.
 */
export function BackgroundLocationCard() {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [can, on] = await Promise.all([
        isBackgroundLocationAvailable(),
        isBackgroundLocationEnabled(),
      ])
      if (!cancelled) { setAvailable(can); setEnabled(on) }
    })()
    return () => { cancelled = true }
  }, [])

  const toggle = useCallback(async () => {
    setBusy(true)
    setRefused(false)
    try {
      if (enabled) {
        await stopBackgroundLocation()
        setEnabled(false)
      } else {
        const started = await startBackgroundLocation()
        setEnabled(started)
        // The permission prompt is the only thing that can refuse here, and it
        // is refusable twice — after which Android stops asking and the only
        // way back is the OS settings page.
        setRefused(!started)
      }
    } finally {
      setBusy(false)
    }
  }, [enabled])

  // Still checking, or plain web where there is no native watcher to offer.
  if (available === null) return null

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Automatic place check-ins
        </p>

        {available ? (
          <>
            <p className="text-xs text-muted-foreground">
              Emergy notices when you&apos;ve spent a while somewhere you&apos;ve saved — the garden,
              a café — and logs the visit without you opening anything. Android shows a
              notification the whole time it&apos;s running.
            </p>
            <Button
              onClick={toggle}
              disabled={busy}
              variant={enabled ? "outline" : "default"}
              size="sm"
              className="gap-2"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
              {enabled ? "Stop following along" : "Let Emergy follow along"}
            </Button>
            {refused && (
              <p className="text-xs text-amber-400">
                Android didn&apos;t grant location. Allow it in settings and try again.{" "}
                <button onClick={() => void openLocationSettings()} className="underline">
                  Open settings
                </button>
              </p>
            )}
            {enabled && (
              <p className="text-[10px] text-muted-foreground/60">
                A visit needs about 20 minutes in one place, so passing by logs nothing.
                Tracking stops if the phone restarts — reopen the app to start it again.
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Only the Android app can track in the background. On the web you can still import
            a Google Timeline export, or point OwnTracks at this account — both land in the
            same place and produce the same check-ins.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
