// Web push for the browser and the installed web app — one subscribe path.
//
// Settings, Emergy's panel and onboarding each had their own: two copies of
// the subscribe call and none at all in onboarding, whose "Enable" asked for
// permission, said "Notifications enabled!" and registered nothing, so no
// push could reach that phone until Settings was found. The Android shell
// never comes here; it schedules its notifications on the device.

import { isNativeShell } from "@/lib/native/shell"

export type SubscribeResult = "subscribed" | "unsupported" | "denied" | "unconfigured" | "failed"

export interface IosEnv {
  ua: string
  /** navigator.standalone, or display-mode: standalone — opened from the Home Screen. */
  standalone: boolean
  maxTouchPoints: number
}

function readIosEnv(): IosEnv | null {
  if (typeof window === "undefined") return null
  try {
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
      || window.matchMedia("(display-mode: standalone)").matches
    return { ua: navigator.userAgent, standalone, maxTouchPoints: navigator.maxTouchPoints ?? 0 }
  } catch {
    return null
  }
}

/** True on an iPhone or iPad, in a tab or from the Home Screen. */
export function isAppleMobile(env: IosEnv | null = readIosEnv()): boolean {
  if (!env) return false
  return /iphone|ipad|ipod/i.test(env.ua) || (/macintosh/i.test(env.ua) && env.maxTouchPoints > 1)
}

/**
 * True on an iPhone or iPad in a Safari tab. iOS gives web push only to a
 * site opened from the Home Screen (16.4+), so a tab has neither Notification
 * nor PushManager and an Enable button there can only fail. An iPad asking
 * for the desktop site reports itself as a Mac; touch points give it away.
 */
export function iosNeedsHomeScreen(env: IosEnv | null = readIosEnv()): boolean {
  return isAppleMobile(env) && !!env && !env.standalone
}

/**
 * Never in the shell: registering the worker there would reinstall the one
 * the app strips on launch, and with it the stale-code failure mode.
 */
export function webPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator
    && "PushManager" in window && typeof Notification !== "undefined" && !isNativeShell()
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/**
 * Ask for permission if it hasn't been given, subscribe this browser and save
 * the subscription. Must run from a tap: iOS refuses a prompt that isn't.
 */
export async function subscribeWebPush(): Promise<SubscribeResult> {
  if (!webPushSupported()) return "unsupported"
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!vapidKey) return "unconfigured"
  try {
    if (Notification.permission !== "granted") {
      const perm = await Notification.requestPermission()
      if (perm !== "granted") return "denied"
    }
    await navigator.serviceWorker.register("/sw.js")
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    })
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    })
    if (!res.ok) {
      // A subscription the server never stored is one no push can use.
      await sub.unsubscribe().catch(() => {})
      return "failed"
    }
    return "subscribed"
  } catch {
    return Notification.permission === "denied" ? "denied" : "failed"
  }
}
