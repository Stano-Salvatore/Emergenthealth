"use client"

import { useCallback, useEffect, useState } from "react"
import { Capacitor } from "@capacitor/core"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  activityStatus, headStatus, requestActivityPermission,
  requestBatteryUnrestricted, requestOverlayPermission,
} from "@/lib/native/bubble"
import { ensureNotificationPermission, getNotificationPermission } from "@/lib/native/notifications"
import { startBackgroundLocation } from "@/lib/native/background-location"
import { nativeLocationStatus, openAppSettings } from "@/lib/native/location-service"

/**
 * Everything the app needs from Android, in one pass.
 *
 * Granting these one card at a time meant reading twenty-five cards to find
 * the four that were asking for something, and three of the four are the same
 * fight — Samsung would rather the app slept. This gathers them.
 *
 * It is deliberately NOT sold as one tap, because Android will not allow that.
 * Permissions here come in two kinds and they behave differently:
 *
 *  - A **prompt** is a dialog inside the app. Those can be fired one after
 *    another, so the button does exactly that.
 *  - A **settings trip** has no prompt at all. "Allow all the time" has had no
 *    runtime dialog since Android 11; battery and overlay open a system screen.
 *    Each of those leaves the app, so chaining them would fling the user
 *    through three screens with no idea which one they were on. They get their
 *    own buttons and re-check themselves when you come back.
 *
 * And one thing nothing here can do or even verify: Samsung's own sleeping-apps
 * list. It has no API. Saying so is better than a tick that means nothing.
 */

type Item = {
  id: string
  label: string
  why: string
  done: boolean
  kind: "prompt" | "settings"
  run: () => Promise<unknown>
}

export function PermissionSetup() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return
    const [notif, svc, head, motion] = await Promise.all([
      getNotificationPermission().catch(() => "unavailable" as const),
      nativeLocationStatus().catch(() => null),
      headStatus().catch(() => null),
      activityStatus().catch(() => ({ available: false, permitted: false, tracking: false })),
    ])

    const next: Item[] = []

    next.push({
      id: "notif", label: "Notifications", kind: "prompt",
      why: "reminders, nudges and anything Emergy wants to tell you",
      done: notif === "granted",
      run: ensureNotificationPermission,
    })

    if (motion.available) {
      next.push({
        id: "motion", label: "Motion", kind: "prompt",
        why: "recognises walking, so a day with no walk differs from a day not tracked",
        done: motion.permitted,
        run: requestActivityPermission,
      })
    }

    if (svc) {
      next.push({
        id: "loc", label: "Location", kind: "prompt",
        why: "the places you spend time at, and where the night was spent",
        done: svc.fine,
        run: startBackgroundLocation,
      })
      // Separate from the prompt above on purpose: Android 11 removed the
      // runtime dialog for this level, so the only thing an app may do is
      // point at the screen where it lives.
      if (svc.fine) {
        next.push({
          id: "loc-bg", label: "Location: Allow all the time", kind: "settings",
          why: "anything less and Android stops the fixes the moment you leave the app",
          done: svc.background,
          run: openAppSettings,
        })
      }
      next.push({
        id: "batt", label: "Ignore battery optimisation", kind: "settings",
        why: "without it Android kills the location service and the chat head — quietly, and only sometimes",
        done: svc.batteryUnrestricted,
        run: requestBatteryUnrestricted,
      })
    }

    if (head) {
      next.push({
        id: "overlay", label: "Draw over other apps", kind: "settings",
        why: "the chat head that survives closing the app",
        done: head.granted,
        run: requestOverlayPermission,
      })
    }

    setItems(next)
  }, [])

  // Half of these are decided on Android's own screens, and coming back is the
  // only moment the app can learn what happened there.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    void load()
    const onVisible = () => { if (document.visibilityState === "visible") void load() }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [load])

  if (!items || items.length === 0) return null

  const missing = items.filter(i => !i.done)
  const prompts = missing.filter(i => i.kind === "prompt")
  const trips = missing.filter(i => i.kind === "settings")

  // Nothing to ask for. The Samsung note below is the one thing that stays
  // worth saying, but not on its own card — the status rows cover the rest.
  if (missing.length === 0) return null

  const askAll = async () => {
    setBusy("all")
    try {
      // In sequence, not in parallel: Android shows one permission dialog at a
      // time and drops the rest, so firing them together loses all but the first.
      for (const i of prompts) {
        try { await i.run() } catch { /* a refusal is an answer; the reload shows it */ }
      }
    } finally {
      await load()
      setBusy(null)
    }
  }

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardContent className="pt-4 pb-4 space-y-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Permissions</p>
          <p className="text-xs text-muted-foreground mt-1">
            {missing.length} thing{missing.length === 1 ? "" : "s"} Android hasn&apos;t granted yet.
            {trips.length > 0 && " Some have no in-app prompt and open a settings screen instead."}
          </p>
        </div>

        {prompts.length > 0 && (
          <div>
            <Button size="sm" onClick={askAll} disabled={busy !== null}>
              {busy === "all" ? "Asking…" : `Ask for ${prompts.length === 1 ? "it" : `all ${prompts.length}`}`}
            </Button>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {prompts.map(p => p.label).join(", ")} — one dialog after another.
            </p>
          </div>
        )}

        {trips.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {trips.map(t => (
              <div key={t.id} className="flex items-start justify-between gap-3 py-1.5 border-b border-border/40 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm leading-snug">{t.label}</p>
                  <p className="text-[11px] text-muted-foreground leading-snug">{t.why}</p>
                </div>
                <Button
                  size="sm" variant="secondary" className="shrink-0"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(t.id)
                    try { await t.run() } catch { /* nothing to say if the OS won't open its own screen */ }
                    finally { setBusy(null) }
                  }}
                >
                  Open
                </Button>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/80 pt-1 leading-snug">
          <span className="text-foreground/80">One more, by hand:</span> Battery → Background usage limits →
          Never sleeping apps → add Emergy. That is Samsung&apos;s own layer on top of the exemption above, it
          has no API, and it is usually what explains a service that dies overnight — so nothing here can tick
          it off for you or even check it.
        </p>
      </CardContent>
    </Card>
  )
}
