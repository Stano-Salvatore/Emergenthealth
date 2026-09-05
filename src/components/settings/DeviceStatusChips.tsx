"use client"

import { useCallback, useEffect, useState } from "react"
import { Capacitor } from "@capacitor/core"
import { headStatus, activityStatus } from "@/lib/native/bubble"
import { getNotificationPermission } from "@/lib/native/notifications"
import { readBackgroundLocationEnabled, startBackgroundLocation } from "@/lib/native/background-location"
import { getLastLocationStartFailure, nativeLocationStatus } from "@/lib/native/location-service"
import { getAutoSpeak, speechSupported } from "@/lib/voice"
import type { StatusRow } from "@/lib/status-rows"

/**
 * A row that can also do something about what it reports.
 *
 * "Should be tracking but isn't" was a diagnosis with no cure attached: the
 * remedies it implied — the permission, the battery exemption — are rendered
 * as their own rows, and once those are green the sentence blames the reader
 * for something they have already done. Android refuses a background start of
 * a foreground service, but a start from a button the user just pressed is
 * always allowed, so the card can simply fix it.
 */
type DeviceRow = StatusRow & { action?: { label: string; run: () => Promise<unknown> } }

/**
 * The part of the status card only the phone can answer: permissions, and
 * whether the things that run on the device are actually running. Nothing on
 * the web, because none of it exists there.
 */
export function DeviceStatusChips() {
  const [rows, setRows] = useState<DeviceRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return
    const [notif, head, loc, svc, motion] = await Promise.all([
      getNotificationPermission().catch(() => "unavailable" as const),
      headStatus().catch(() => null),
      readBackgroundLocationEnabled().catch(() => ({ enabled: false, failure: null })),
      nativeLocationStatus().catch(() => null),
      activityStatus().catch(() => ({ available: false, permitted: false, tracking: false })),
    ])
    const out: DeviceRow[] = []
    out.push(notif === "granted"
      ? { id: "d-notif", group: "Notifications", label: "This phone", tone: "ok", value: "notifications allowed" }
      : { id: "d-notif", group: "Notifications", label: "This phone", tone: "warn", value: notif === "denied" ? "notifications blocked" : "notifications not allowed yet" })
    if (head) {
      out.push(!head.granted
        ? { id: "d-head", group: "Emergy", label: "Chat head", tone: "off", value: "overlay permission off" }
        : head.running
          ? { id: "d-head", group: "Emergy", label: "Chat head", tone: "ok", value: head.keep ? "floating, stays after close" : "floating" }
          : { id: "d-head", group: "Emergy", label: "Chat head", tone: head.keep ? "warn" : "off", value: head.keep ? "should be floating but isn't" : "put away" })
      if (head.batteryUnrestricted === false) {
        out.push({ id: "d-batt", group: "Emergy", label: "Battery", tone: "warn", value: "optimised — Android may kill him", detail: "Settings → Emergy floating → Allow background" })
      }
    }
    if (!loc.enabled) {
      // "Off" and "couldn't find out" are different answers, and
      // readBackgroundLocationEnabled goes to the trouble of separating them —
      // it falls back to off so the card stays usable, and hands back the
      // failure so the fallback is not mistaken for a fact. This read it as a
      // fact anyway, which is how the card came to say "off" beside another
      // card on the same screen saying tracking was switched on. A bridge
      // call that times out is not a switch that is off.
      out.push(loc.failure
        ? { id: "d-loc", group: "Data", label: "Background location", tone: "warn",
            value: "couldn't read the switch", detail: loc.failure }
        : { id: "d-loc", group: "Data", label: "Background location", tone: "off", value: "off" })
    } else if (svc) {
      // The native service can say whether it is actually running, which the
      // saved switch position cannot.
      out.push(svc.running
        ? { id: "d-loc", group: "Data", label: "Background location", tone: "ok", value: "tracking, survives closing the app" }
        : {
            id: "d-loc", group: "Data", label: "Background location", tone: "warn",
            value: "should be tracking but isn't",
            // Most specific first. The service's own recorded fault beats
            // everything else — it comes from the only layer that watched the
            // thing die, and it outlives the page, so a death overnight is
            // still there in the morning. Then this session's start attempt,
            // then a tracking flag the switch says should be on. Only with
            // none of those on file is it worth saying the permissions are
            // not what's wrong, since their own rows appear below when they
            // are.
            detail: svc.lastFault
              || svc.restartFault
              || getLastLocationStartFailure()
              || (!svc.keep ? "the phone's tracking flag is off — the service gave up rather than being stopped" : undefined)
              || (svc.background && svc.batteryUnrestricted ? "permissions are fine — it just stopped" : undefined),
            action: { label: "Start now", run: startBackgroundLocation },
          })
      // Only when something is actually wrong. A handful of points waiting
      // between flushes is the normal rhythm, not news — but a service that is
      // tracking perfectly and cannot reach the server looks, from every other
      // row on this card, exactly like one that never collected anything.
      if (svc.uploadFault) {
        const stuck = svc.queued ?? 0
        out.push({
          id: "d-loc-upload", group: "Data", label: "Location uploads", tone: "warn",
          value: stuck > 0 ? `${stuck} point${stuck === 1 ? "" : "s"} stuck` : "not getting through",
          detail: svc.uploadFault,
        })
      }
      if (svc.fine && !svc.background) {
        out.push({ id: "d-loc-bg", group: "Data", label: "Location permission", tone: "warn", value: "only while using the app", detail: "Set it to Allow all the time" })
      }
      if (!svc.batteryUnrestricted && !out.some(r => r.id === "d-batt")) {
        out.push({ id: "d-batt", group: "Data", label: "Battery", tone: "warn", value: "optimised — Android may stop tracking", detail: "Settings → Automatic place check-ins → Allow background" })
      }
    } else {
      out.push({ id: "d-loc", group: "Data", label: "Background location", tone: loc.failure ? "warn" : "ok", value: loc.failure ? loc.failure : "tracking while the app is open" })
    }
    // Emergy has been able to speak all along — lib/voice reads his replies
    // through the phone's own text-to-speech, and the manifest already
    // declares the engine so the WebView can find it. It is off by default,
    // and the only two switches are a speaker icon in the chat header and a
    // toggle far down this page, so "he doesn't have a voice" is what it
    // looks like from outside. A row that says so is the cheapest fix.
    if (speechSupported()) {
      out.push(getAutoSpeak()
        ? { id: "d-voice", group: "Emergy", label: "Voice", tone: "ok", value: "reads replies aloud" }
        : { id: "d-voice", group: "Emergy", label: "Voice", tone: "off", value: "silent", detail: "Settings → Voice → Read replies aloud" })
    }
    if (motion.available) {
      out.push({ id: "d-motion", group: "Data", label: "Motion", tone: motion.tracking ? "ok" : "off", value: motion.tracking ? "tracking" : motion.permitted ? "off" : "no permission" })
    }
    setRows(out)
  }, [])

  // Read once now, and again on every return to the foreground.
  //
  // Half of what this card reports is decided in Android's own settings, and
  // the only moment the app can learn about a change there is coming back.
  // Reading once at mount meant the card went on describing the permissions as
  // they were BEFORE the trip to settings — so it sat beside the location card
  // saying the opposite thing about the same phone, and the stale one looked
  // exactly as confident as the one that was right.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    void (async () => { await load() })()
    const onVisible = () => { if (document.visibilityState === "visible") void load() }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [load])

  if (!rows || rows.length === 0) return null
  return (
    <div className="pt-1 sm:col-span-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 pt-1">This phone</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
        {rows.map(r => (
          <div key={r.id} className="flex items-start justify-between gap-3 py-1.5 border-b border-border/40">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`h-2 w-2 rounded-full shrink-0 ${r.tone === "ok" ? "bg-emerald-400" : r.tone === "warn" ? "bg-amber-400" : r.tone === "bad" ? "bg-red-400" : "bg-muted-foreground/40"}`} aria-hidden />
              <span className="text-sm leading-snug truncate">{r.label}</span>
            </div>
            <div className="text-right shrink-0 max-w-[55%]">
              <p className={`text-xs leading-snug ${r.tone === "warn" ? "text-amber-400" : r.tone === "bad" ? "text-red-400" : r.tone === "off" ? "text-muted-foreground" : "text-foreground"}`}>{r.value}</p>
              {r.detail && <p className="text-[10px] text-muted-foreground leading-snug break-words">{r.detail}</p>}
              {r.action && (
                <button
                  onClick={async () => {
                    const run = r.action?.run
                    if (!run) return
                    setBusy(r.id)
                    // Re-read either way: a start that failed has changed the
                    // row's reason, and that is what the presser needs to see.
                    try { await run() } catch { /* the reload reports it */ }
                    finally { await load(); setBusy(null) }
                  }}
                  disabled={busy === r.id}
                  className="mt-1 text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                >
                  {busy === r.id ? "Starting…" : r.action.label}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
