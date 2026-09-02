"use client"

import { useEffect, useState } from "react"
import { Capacitor } from "@capacitor/core"
import { headStatus, activityStatus } from "@/lib/native/bubble"
import { getNotificationPermission } from "@/lib/native/notifications"
import { readBackgroundLocationEnabled } from "@/lib/native/background-location"
import type { StatusRow } from "@/lib/status-rows"

/**
 * The part of the status card only the phone can answer: permissions, and
 * whether the things that run on the device are actually running. Nothing on
 * the web, because none of it exists there.
 */
export function DeviceStatusChips() {
  const [rows, setRows] = useState<StatusRow[] | null>(null)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let cancelled = false
    ;(async () => {
      const [notif, head, loc, motion] = await Promise.all([
        getNotificationPermission().catch(() => "unavailable" as const),
        headStatus().catch(() => null),
        readBackgroundLocationEnabled().catch(() => ({ enabled: false, failure: null })),
        activityStatus().catch(() => ({ available: false, permitted: false, tracking: false })),
      ])
      if (cancelled) return
      const out: StatusRow[] = []
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
      out.push(loc.enabled
        ? { id: "d-loc", group: "Data", label: "Background location", tone: loc.failure ? "warn" : "ok", value: loc.failure ? loc.failure : "tracking" }
        : { id: "d-loc", group: "Data", label: "Background location", tone: "off", value: "off" })
      if (motion.available) {
        out.push({ id: "d-motion", group: "Data", label: "Motion", tone: motion.tracking ? "ok" : "off", value: motion.tracking ? "tracking" : motion.permitted ? "off" : "no permission" })
      }
      setRows(out)
    })()
    return () => { cancelled = true }
  }, [])

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
              {r.detail && <p className="text-[10px] text-muted-foreground leading-snug">{r.detail}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
