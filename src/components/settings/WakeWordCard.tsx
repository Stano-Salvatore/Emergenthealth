"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Ear, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type WakeStatus,
  wakeStatus, startWake, stopWake, setWakeChargingOnly, testWakeFire,
} from "@/lib/native/wake-word"
import { requestBatteryUnrestricted } from "@/lib/native/bubble"

/**
 * The wake word, and what it can honestly claim.
 *
 * Both halves exist now: the service (milestone one) and the sherpa-onnx
 * recogniser behind it (milestone two). hasDetector is whether this APK
 * carries the model — an install from before milestone two doesn't, and the
 * card still says so instead of implying a microphone that hears. "Try it"
 * fires the handoff by hand either way, because the chain after the ears is
 * worth testing on its own.
 */
export function WakeWordCard() {
  const [status, setStatus] = useState<WakeStatus | null | "loading">("loading")
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(false)

  const refresh = useCallback(async () => {
    setStatus(await wakeStatus().catch(() => null))
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // Permissions and the charger both change outside the app, and coming back
  // is the first moment we can notice either.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") void refresh() }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [refresh])

  const toggle = useCallback(async () => {
    setBusy(true)
    setRefused(false)
    try {
      if (status && status !== "loading" && status.keep) {
        await stopWake()
      } else {
        const r = await startWake()
        if (r === "denied") setRefused(true)
      }
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [status, refresh])

  if (status === "loading") return null
  // Web, or an APK from before this existed. Nothing to offer and nothing to
  // explain — the location card's "grab a newer APK" line covers that story.
  if (status === null) return null

  const on = status.keep

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Wake word
        </p>

        {!status.hasDetector && (
          <p className="text-xs text-amber-400">
            This install predates the recogniser: the listening service is here, but the
            part that knows his name isn&apos;t in this build. Grab the latest APK and it
            will be. Until then, turning it on proves the plumbing — it will not actually
            hear you — and &ldquo;Try it&rdquo; stands in for the real thing.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Say <b>&ldquo;hey Emergy&rdquo;</b> and the chat opens already listening; what
          you say next sends itself after six seconds of quiet. Recognition happens
          entirely on the phone — audio never leaves it.
        </p>

        <Button
          onClick={toggle}
          disabled={busy}
          variant={on ? "outline" : "default"}
          size="sm"
          className="gap-2"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ear className="h-4 w-4" />}
          {on ? "Stop listening" : "Start listening"}
        </Button>

        {refused && (
          <p className="text-xs text-amber-400">
            Android didn&apos;t grant the microphone, so there is nothing to listen with.
          </p>
        )}

        {on && (
          <>
            <div className="flex items-center gap-2 text-xs">
              <span className={cn(
                "h-2 w-2 rounded-full",
                status.listening ? "bg-emerald-400" : "bg-amber-400",
              )} />
              <span className={status.listening ? "text-muted-foreground" : "text-amber-400"}>
                {status.listening
                  ? status.hasDetector
                    ? status.engine === "stub"
                      ? "Microphone open, but the recogniser failed to load"
                      : "Listening for his name"
                    : "Microphone open — nothing behind it in this build"
                  : status.chargingOnly && !status.pluggedIn
                    ? "Paused — only listens while charging"
                    : "Should be listening but isn't"}
              </span>
            </div>

            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={status.chargingOnly}
                onChange={async e => { await setWakeChargingOnly(e.target.checked); await refresh() }}
                className="mt-0.5"
              />
              <span>
                Only while charging.
                {" "}
                <span className="text-muted-foreground/70">
                  Off by default — a wake word that only answers at a desk isn&apos;t much of
                  one. Turn it on if holding the microphone open all day costs you more
                  battery than it&apos;s worth.
                </span>
              </span>
            </label>

            {!status.batteryUnrestricted && (
              <div className="space-y-1">
                <p className="text-xs text-amber-400">
                  Battery optimisation still applies, which is how Samsung phones quietly
                  kill a listening service.
                </p>
                <Button variant="outline" size="sm"
                  onClick={() => { void requestBatteryUnrestricted().then(() => refresh()) }}>
                  Allow background
                </Button>
              </div>
            )}

            <Button variant="outline" size="sm"
              onClick={() => { void testWakeFire() }}>
              Try it — pretend you said it
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
