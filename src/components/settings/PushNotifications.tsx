"use client"

import { useState, useEffect } from "react"
import { Bell, BellOff, Send, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

function formatHour(h: number) {
  if (h === 0) return "12:00 AM"
  if (h < 12) return `${h}:00 AM`
  if (h === 12) return "12:00 PM"
  return `${h - 12}:00 PM`
}

export function PushNotifications() {
  const [supported, setSupported] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>("default")
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [testStatus, setTestStatus] = useState<"idle" | "sent" | "error">("idle")
  const [testError, setTestError] = useState<string | null>(null)
  const [reminderHour, setReminderHour] = useState(7)
  const [savingHour, setSavingHour] = useState(false)
  const [hourSaved, setHourSaved] = useState(false)
  const [noonReminderEnabled, setNoonReminderEnabled] = useState(true)
  const [savingNoon, setSavingNoon] = useState(false)
  const [eveningReminderEnabled, setEveningReminderEnabled] = useState(true)
  const [savingEvening, setSavingEvening] = useState(false)

  useEffect(() => {
    const ok = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window
    setSupported(ok)
    if (ok) {
      setPermission(Notification.permission)
      navigator.serviceWorker.ready.then((reg) =>
        reg.pushManager.getSubscription().then((sub) => setSubscribed(!!sub))
      ).catch(() => {})
    }
    Promise.all([
      fetch("/api/preferences/reminder-time").then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/preferences/noon-reminder").then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/preferences/evening-reminder").then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([timeData, noonData, eveningData]) => {
      if (timeData?.hour != null) setReminderHour(timeData.hour)
      if (noonData?.enabled != null) setNoonReminderEnabled(noonData.enabled)
      if (eveningData?.enabled != null) setEveningReminderEnabled(eveningData.enabled)
    })
  }, [])

  async function subscribe() {
    setLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidKey) {
        alert("Push notifications are not configured yet.")
        setLoading(false)
        return
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
      })
      setPermission(Notification.permission)
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      })
      if (!res.ok) {
        await sub.unsubscribe()
        console.error("Failed to save subscription", await res.text())
        setLoading(false)
        return
      }
      setSubscribed(true)
    } catch (err) {
      console.error(err)
      setPermission(Notification.permission)
    }
    setLoading(false)
  }

  async function unsubscribe() {
    setLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setSubscribed(false)
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  async function sendTest() {
    setTestStatus("idle")
    setTestError(null)
    const res = await fetch("/api/push/test", { method: "POST" })
    if (res.ok) {
      setTestStatus("sent")
      setTimeout(() => setTestStatus("idle"), 3000)
    } else {
      const data = await res.json().catch(() => ({}))
      setTestError(data.error ?? `Error ${res.status}`)
      setTestStatus("error")
    }
  }

  async function toggleNoonReminder() {
    setSavingNoon(true)
    const next = !noonReminderEnabled
    setNoonReminderEnabled(next)
    await fetch("/api/preferences/noon-reminder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => {})
    setSavingNoon(false)
  }

  async function toggleEveningReminder() {
    setSavingEvening(true)
    const next = !eveningReminderEnabled
    setEveningReminderEnabled(next)
    await fetch("/api/preferences/evening-reminder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => {})
    setSavingEvening(false)
  }

  async function saveReminderHour(h: number) {
    setSavingHour(true)
    setReminderHour(h)
    await fetch("/api/preferences/reminder-time", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hour: h }),
    }).catch(() => {})
    setSavingHour(false)
    setHourSaved(true)
    setTimeout(() => setHourSaved(false), 2000)
  }

  if (!supported) return null

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-4">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Push Notifications</p>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Morning check-in reminder</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {permission === "denied"
                ? "Notifications are blocked. Enable them in your browser settings."
                : "Get a daily nudge to log how you're feeling."}
            </p>
          </div>
          {permission !== "denied" && (
            <Button
              size="sm"
              variant={subscribed ? "outline" : "default"}
              className="shrink-0"
              disabled={loading}
              onClick={subscribed ? unsubscribe : subscribe}
            >
              {subscribed ? <><BellOff className="h-3.5 w-3.5 mr-1.5" />Disable</> : <><Bell className="h-3.5 w-3.5 mr-1.5" />Enable</>}
            </Button>
          )}
        </div>

        {subscribed && (
          <div className="border-t border-border/50 pt-3 space-y-3">
            {/* Reminder time picker */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs font-medium">Reminder time</p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {savingHour ? "Saving…" : hourSaved ? "✓ Saved" : formatHour(reminderHour)}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[5, 6, 7, 8, 9, 10].map(h => (
                  <button
                    key={h}
                    onClick={() => saveReminderHour(h)}
                    className={`px-2.5 py-1 rounded-lg text-xs border transition-all ${
                      reminderHour === h
                        ? "bg-primary/15 border-primary text-primary font-medium"
                        : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    }`}
                  >
                    {formatHour(h)}
                  </button>
                ))}
              </div>
            </div>

            {/* Noon intention reminder */}
            <div className="flex items-center justify-between pt-1 border-t border-border/30">
              <div>
                <p className="text-xs font-medium">Noon intention reminder</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Reminds you of your morning intention at 12pm</p>
              </div>
              <button
                onClick={toggleNoonReminder}
                disabled={savingNoon}
                className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${
                  noonReminderEnabled ? "bg-primary" : "bg-secondary"
                }`}
                role="switch"
                aria-checked={noonReminderEnabled}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  noonReminderEnabled ? "translate-x-4" : "translate-x-0.5"
                }`} />
              </button>
            </div>

            {/* Evening reflection reminder */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium">Evening reflection reminder</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Journal nudge at 9pm if you haven&apos;t written today</p>
              </div>
              <button
                onClick={toggleEveningReminder}
                disabled={savingEvening}
                className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${
                  eveningReminderEnabled ? "bg-primary" : "bg-secondary"
                }`}
                role="switch"
                aria-checked={eveningReminderEnabled}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  eveningReminderEnabled ? "translate-x-4" : "translate-x-0.5"
                }`} />
              </button>
            </div>

            {/* Test notification */}
            <div className="flex items-center justify-between pt-1 border-t border-border/30">
              <p className="text-xs text-muted-foreground">Test on this device</p>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" onClick={sendTest}>
                <Send className="h-3 w-3" />
                {testStatus === "sent" ? "Sent!" : testStatus === "error" ? "Retry" : "Send test"}
              </Button>
            </div>
            {testStatus === "error" && testError && (
              <p className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2">{testError}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
