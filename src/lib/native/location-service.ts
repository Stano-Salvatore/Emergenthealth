import { Capacitor, registerPlugin } from "@capacitor/core"
import { ensureWidgetActivation } from "@/lib/widget-activator"

// The native location service: tracking that does not need the app open.
//
// The community plugin delivers every fix to the WebView, which uploads it.
// That works exactly as long as the WebView lives, and Android ends it the
// moment the app is swiped away, put to sleep, or the phone restarts — and
// nothing re-arms it until the app is opened again. So "Emergy follows me"
// was true only while looking at him.
//
// EmergyLocationService is a foreground service in the Android process. It
// listens, queues to disk and posts with the widget key, so it needs neither
// the page nor the session. This file is the thin bridge to it; the switch in
// lib/native/background-location prefers it whenever the APK has it.

export type NativeLocationStatus = {
  available: boolean
  /** The service is up right now. */
  running: boolean
  /** The user asked for it to stay: it restarts after being killed and at boot. */
  keep: boolean
  /** Precise location granted. */
  fine: boolean
  /** "Allow all the time" granted — without it Android stops the fixes when the app is not on screen. */
  background: boolean
  /** Exempt from battery optimisation; Samsung kills a foreground service otherwise. */
  batteryUnrestricted: boolean
}

type LocationPluginSubset = {
  locationStatus(): Promise<NativeLocationStatus>
  startLocationService(): Promise<void>
  stopLocationService(): Promise<void>
  openAppSettings(): Promise<void>
}

// Same native class as the chat head; registering it twice under the same
// name yields the same proxy, so this costs nothing.
const plugin = registerPlugin<LocationPluginSubset>("EmergyBubble")

/**
 * Null means "this build has no native service" — the web, or an APK from
 * before it existed. The caller falls back to the WebView watcher then.
 */
export async function nativeLocationStatus(): Promise<NativeLocationStatus | null> {
  if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return null
  if (!Capacitor.isPluginAvailable("EmergyBubble")) return null
  try {
    const s = await plugin.locationStatus()
    return s?.available ? s : null
  } catch {
    // "not implemented": the plugin class predates the method.
    return null
  }
}

/**
 * Start the service.
 *
 * The widget key is what it posts with, so make sure the phone has one before
 * the first fix is queued — a fresh install that never opened a widget would
 * otherwise collect points it can never send.
 */
export async function startNativeLocation(): Promise<"started" | "denied" | "unavailable"> {
  if ((await nativeLocationStatus()) === null) return "unavailable"
  await ensureWidgetActivation().catch(() => "failed" as const)
  try {
    await plugin.startLocationService()
    return "started"
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/NOT_AUTHORIZED|denied|permission/i.test(msg)) return "denied"
    return "unavailable"
  }
}

export async function stopNativeLocation(): Promise<void> {
  if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return
  try { await plugin.stopLocationService() } catch { /* older build, or nothing running */ }
}

/**
 * The app's own page in Android settings, where "Allow all the time" lives.
 * There is no runtime prompt for that level from Android 11 on; the OS only
 * lets an app point at the screen.
 */
export async function openAppSettings(): Promise<void> {
  if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return
  try { await plugin.openAppSettings() } catch { /* nothing to open */ }
}
