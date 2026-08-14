"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Bell, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { isNativeApp } from "@/lib/native/geolocation"
import {
  nudgesEnabled,
  setNudgesEnabled,
  resyncNotifications,
  scheduleTestNotification,
  getNotificationPermission,
  ensureNotificationPermission,
  getExactAlarmPermission,
  requestExactAlarmPermission,
  getScheduledStatus,
  type ScheduledStatus,
} from "@/lib/native/notifications"

type Perm = "granted" | "denied" | "prompt" | "unavailable" | "loading"
type Exact = "granted" | "denied" | "unavailable" | "loading"

export function NotificationNudges() {
  const [inApp, setInApp] = useState(false)
  const [on, setOn] = useState(true)
  const [perm, setPerm] = useState<Perm>("loading")
  const [exact, setExact] = useState<Exact>("loading")
  const [test, setTest] = useState<"idle" | "sending" | "scheduled" | "denied" | "unavailable">("idle")
  const [status, setStatus] = useState<ScheduledStatus | null>(null)
  const [resyncing, setResyncing] = useState(false)

  useEffect(() => {
    isNativeApp().then(async native => {
      setInApp(native)
      if (native) {
        setOn(nudgesEnabled())
        setPerm(await getNotificationPermission())
        setExact(await getExactAlarmPermission())
        setStatus(await getScheduledStatus())
      }
    })
  }, [])

  // Native-only — the web build can't fire local notifications.
  if (!inApp) return null

  async function enable() {
    setPerm("loading")
    const granted = await ensureNotificationPermission()
    setPerm(granted ? "granted" : "denied")
    if (granted) await resyncNotifications()
    setStatus(await getScheduledStatus())
  }

  async function toggle() {
    const next = !on
    setOn(next)
    setNudgesEnabled(next)
    if (next) {
      const granted = await ensureNotificationPermission()
      setPerm(granted ? "granted" : "denied")
    }
    await resyncNotifications()
    setStatus(await getScheduledStatus())
  }

  async function resync() {
    setResyncing(true)
    await resyncNotifications()
    setStatus(await getScheduledStatus())
    setResyncing(false)
  }

  async function sendTest() {
    setTest("sending")
    const res = await scheduleTestNotification()
    setPerm(await getNotificationPermission())
    setTest(res === "scheduled" ? "scheduled" : res)
    if (res === "scheduled") setTimeout(() => setTest("idle"), 5000)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bell className="h-4 w-4" /> Phone Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Permission state / enable */}
        {perm === "denied" ? (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5">
            <p className="text-xs font-medium text-red-400">Notifications are blocked</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Turn them on in Android: Settings → Apps → Emergenthealth → Notifications, then come back and hit &ldquo;Send test&rdquo;.
            </p>
          </div>
        ) : perm === "prompt" || perm === "loading" ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Allow Emergenthealth to send you notifications.</p>
            <Button size="sm" className="shrink-0" disabled={perm === "loading"} onClick={enable}>
              <Bell className="h-3.5 w-3.5 mr-1.5" /> Enable
            </Button>
          </div>
        ) : perm === "unavailable" ? (
          <p className="text-xs text-muted-foreground">
            This build doesn&apos;t support notifications yet — it may need updating from the Play Store.
          </p>
        ) : status && status.pending === 0 ? (
          // Permission is granted yet nothing is laid down — the state that
          // used to be indistinguishable from everything working.
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5 space-y-1.5">
            <p className="text-xs font-medium text-amber-400">
              Notifications are allowed, but nothing is scheduled on this phone
            </p>
            <p className="text-[11px] text-muted-foreground">
              So nothing will buzz. Resync should fix it — if the count stays at zero afterwards,
              this build can&apos;t schedule notifications and the app needs updating.
            </p>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={resyncing} onClick={resync}>
              {resyncing ? "Resyncing…" : "Resync now"}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-green-400">
            ✓ Notifications are on
            {status ? ` — ${status.pending} scheduled on this phone` : " for this phone"}
            {status?.nextAt ? ` (next: ${new Date(status.nextAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })})` : ""}.
          </p>
        )}

        {/* Exact timing. Only worth showing once notifications actually work,
            and only when Android has something left to grant. */}
        {perm === "granted" && exact === "denied" && (
          <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-3">
            <div className="min-w-0">
              <p className="text-xs font-medium">Reminders arrive within a few minutes</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Android batches them to save battery. Allow exact alarms and 07:30 means 07:30.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs shrink-0"
              onClick={async () => {
                setExact("loading")
                setExact(await requestExactAlarmPermission())
                await resyncNotifications()
                setStatus(await getScheduledStatus())
              }}
            >
              Allow
            </Button>
          </div>
        )}
        {perm === "granted" && exact === "granted" && (
          <p className="text-[11px] text-green-400 border-t border-border/40 pt-3">
            ✓ Exact timing on — reminders fire at the minute you set.
          </p>
        )}

        {/* Daily nudges toggle */}
        <div className="flex items-center justify-between gap-4 border-t border-border/40 pt-3">
          <p className="text-sm text-muted-foreground">
            Daily nudges — morning check-in, hydration (13:00), and habits (20:00).
            The morning time and which of the three you get are set above.
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

        {/* Test */}
        <div className="flex items-center justify-between border-t border-border/40 pt-3">
          <p className="text-xs text-muted-foreground">
            {test === "scheduled" ? "Sent — should appear in ~3s 👀"
              : test === "denied" ? "Blocked — enable notifications first"
              : test === "unavailable" ? "Not supported on this build"
              : "Check it works on this phone"}
          </p>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 shrink-0" disabled={test === "sending"} onClick={sendTest}>
            <Send className="h-3 w-3" />
            {test === "sending" ? "Sending…" : "Send test"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
