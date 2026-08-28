"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { MapPin, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  type LocationSupport,
  backgroundLocationSupport,
  diagnoseBackgroundLocation,
  readBackgroundLocationEnabled,
  openLocationSettings,
  startBackgroundLocation,
  stopBackgroundLocation,
} from "@/lib/native/background-location"

/**
 * Both checks cross the Capacitor bridge, and a bridge call to a plugin the
 * native side never registered simply never answers. Waiting forever leaves
 * this card blank, which reads as "feature absent" rather than "something is
 * wrong" — so give up and say so instead.
 */
const CHECK_TIMEOUT_MS = 6000

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`the location check did not answer in ${CHECK_TIMEOUT_MS / 1000}s`)), CHECK_TIMEOUT_MS),
    ),
  ])
}

/**
 * The one switch that makes place check-ins happen by themselves.
 *
 * Everything behind it already worked from OwnTracks or a Timeline import —
 * this just lets the app supply its own points, so there is no second app to
 * install and no export to remember.
 */
export function BackgroundLocationCard() {
  const [support, setSupport] = useState<LocationSupport | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(false)
  /** How many places are saved; null while unknown, which says nothing. */
  const [places, setPlaces] = useState<number | null>(null)
  /** Why the check failed, shown rather than swallowed. See the effect. */
  const [problem, setProblem] = useState<string | null>(null)
  /** Which piece did what, measured rather than guessed. */
  const [detail, setDetail] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Support first, and ALONE. It is two synchronous reads — what platform
      // this is, and whether the native class is in the APK — so it cannot
      // hang, and nothing that can hang belongs in front of it.
      //
      // The saved on/off flag used to share a Promise.all with this, and that
      // flag is a bridge call: an unanswered read left support unknown, the
      // card rendered nothing, and the feature looked absent rather than
      // stuck. A switch's position is not worth waiting on to decide whether
      // to show the switch.
      try {
        const can = await withTimeout(backgroundLocationSupport())
        if (cancelled) return
        setSupport(can)
        if (can !== "ready") return
      } catch (err) {
        if (cancelled) return
        setSupport("web")
        setProblem(err instanceof Error ? `${err.name}: ${err.message}` : String(err))
        setDetail(await diagnoseBackgroundLocation().catch(() => null))
        return
      }

      // Now the parts that may be slow, each on its own, none of them able to
      // take the card down with it.
      const { enabled: on, failure } = await readBackgroundLocationEnabled()
      if (cancelled) return
      setEnabled(on)
      // Off is the safe default, and it is also a guess. Say when it was one:
      // this read hanging is the whole reason the card went blank, and a fix
      // that hides its own symptom leaves nothing to chase next time.
      if (failure) setDetail(await diagnoseBackgroundLocation().catch(() => null))

      // A stay is only ever noticed INSIDE a saved place — recordPlaceVisits
      // returns immediately when there are none. So with nothing saved the
      // whole chain runs perfectly and produces nothing: the notification
      // shows, points upload, and no check-in ever appears. That is
      // indistinguishable from the feature being broken, which is exactly
      // the failure this card was built on top of. Better to say it up front.
      const saved = await fetch("/api/saved-places")
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
      if (!cancelled && Array.isArray(saved)) setPlaces(saved.length)
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
        // Refusal arrives through this callback, not through the return value:
        // the plugin's addWatcher resolves the moment it is called, long before
        // Android has asked anyone anything. Reading the boolean for a denial
        // meant the branch never ran, and a refused prompt left the button
        // saying "Stop following along" with nothing tracking behind it.
        const started = await startBackgroundLocation(() => {
          setEnabled(false)
          setRefused(true)
        })
        setEnabled(started)
      }
    } finally {
      setBusy(false)
    }
  }, [enabled])

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Automatic place check-ins
        </p>

        {problem && (
          <p className="text-xs text-amber-400">
            Couldn&apos;t tell whether this device can track — {problem}
          </p>
        )}

        {detail && (
          <p className="text-[10px] font-mono text-muted-foreground/70 break-all">{detail}</p>
        )}

        {support === null ? (
          <p className="text-xs text-muted-foreground">Checking what this device can do…</p>
        ) : support === "ready" ? (
          <>
            <p className="text-xs text-muted-foreground">
              Emergy notices when you&apos;ve spent a while somewhere you&apos;ve saved — the garden,
              a café — and logs the visit without you opening anything. Android shows a
              notification the whole time it&apos;s running.
            </p>
            {places === 0 && (
              <p className="text-xs text-amber-400">
                You haven&apos;t saved a place yet, and a visit is only ever noticed inside
                one — so this would track all day and log nothing.{" "}
                <Link href="/dashboard/location" className="underline">
                  Save one first
                </Link>
                .
              </p>
            )}
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
        ) : support === "plugin-missing" ? (
          <p className="text-xs text-amber-400">
            This app build doesn&apos;t contain the location plugin — the web half updates
            itself from the server, but the native half only arrives with an install. Grab
            the latest APK and tracking will appear here.
          </p>
        ) : problem ? (
          // Deliberately NOT the web explanation below: telling someone
          // holding the Android app that only the Android app can track is
          // worse than saying nothing, and that exact sentence is what this
          // card showed while the feature was broken.
          <p className="text-xs text-muted-foreground">
            That is a fault, not a limitation of your phone. A Google Timeline export or
            OwnTracks still works in the meantime.
          </p>
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
