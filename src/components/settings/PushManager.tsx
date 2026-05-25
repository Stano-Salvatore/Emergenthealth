"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Bell, BellOff, Loader2 } from "lucide-react"

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = window.atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i)
  return output
}

export function PushManager() {
  const [supported, setSupported] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>("default")
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return
    setSupported(true)
    setPermission(Notification.permission)
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setSubscribed(!!sub)
        setLoading(false)
      })
    })
  }, [])

  async function enable() {
    setLoading(true)
    const perm = await Notification.requestPermission()
    setPermission(perm)
    if (perm !== "granted") { setLoading(false); return }

    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
        ),
      })
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      })
      setSubscribed(true)
    } catch (err) {
      console.error("Push subscribe error:", err)
    }
    setLoading(false)
  }

  async function disable() {
    setLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        const json = sub.toJSON() as { endpoint: string }
        await sub.unsubscribe()
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: json.endpoint }),
        })
      }
      setSubscribed(false)
    } catch (err) {
      console.error("Push unsubscribe error:", err)
    }
    setLoading(false)
  }

  if (!supported) return null

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">🔔 Push Notifications</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {subscribed
                ? "Daily morning briefing enabled — sleep score + reminders."
                : permission === "denied"
                  ? "Blocked in browser settings — re-enable notifications for this site."
                  : "Daily morning briefing with sleep score and reminders."}
            </p>
          </div>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
          ) : subscribed ? (
            <Button size="sm" variant="outline" onClick={disable} className="gap-1.5 shrink-0">
              <BellOff className="h-3.5 w-3.5" />
              Disable
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={enable}
              disabled={permission === "denied"}
              className="gap-1.5 shrink-0"
            >
              <Bell className="h-3.5 w-3.5" />
              Enable
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
