"use client"

import { useState, useEffect } from "react"
import { Bell, BellOff, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export function PushNotifications() {
  const [supported, setSupported] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>("default")
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [testStatus, setTestStatus] = useState<"idle" | "sent" | "error">("idle")
  const [testError, setTestError] = useState<string | null>(null)

  useEffect(() => {
    const ok = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window
    setSupported(ok)
    if (ok) {
      setPermission(Notification.permission)
      // Check if already subscribed
      navigator.serviceWorker.ready.then((reg) =>
        reg.pushManager.getSubscription().then((sub) => setSubscribed(!!sub))
      ).catch(() => {})
    }
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
          <div className="border-t border-border/50 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Send a test notification to this device</p>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" onClick={sendTest}>
                <Send className="h-3 w-3" />
                {testStatus === "sent" ? "Sent!" : testStatus === "error" ? "Retry" : "Test"}
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
