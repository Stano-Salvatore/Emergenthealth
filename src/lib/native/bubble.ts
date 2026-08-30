import { Capacitor, registerPlugin } from "@capacitor/core"

// Emergy as a floating chat head, the thing Messenger does.
//
// Android calls these Bubbles, and they are deliberately not an overlay: no
// SYSTEM_ALERT_WINDOW, which is the permission that lets an app draw over a
// banking screen. A bubble is a notification the system chooses to float, so
// it stays under the user's control through ordinary notification settings.
//
// Android 11 and up only. Below that this reports unavailable rather than
// pretending — the whole point of the feature is that something visibly
// happens, so a version that quietly does nothing would be worse than a
// version that says it cannot.

/**
 * "none" — bubbles are off for this app, nothing will ever float.
 * "selected" — Android's default from 12 on: it posts the notification and
 *   waits for you to promote this one conversation. Correct build, no bubble.
 * "all" — anything we send floats.
 *
 * The middle state is the one that matters. Treated as a boolean it looks
 * identical to "off", and the two need opposite instructions.
 */
export type BubblePreference = "none" | "selected" | "all" | "unknown"

export type BubbleAvailability = {
  available: boolean   // the OS can do this at all
  allowed: boolean     // every bubble we post floats without further asking
  preference: BubblePreference
  sdk: number
}

/** What the phone says happened, not what we asked for. */
export type BubbleOutcome = {
  posted: boolean
  bubbled: boolean
}

type EmergyBubblePlugin = {
  isAvailable(): Promise<BubbleAvailability>
  show(options: { message: string }): Promise<void>
  hide(): Promise<void>
  didBubble(): Promise<BubbleOutcome>
  openSettings(): Promise<void>
  headStatus(): Promise<HeadStatus>
  requestOverlay(): Promise<void>
  startHead(): Promise<void>
  stopHead(): Promise<void>
  scheduleHeadPops(options: { pops: HeadPop[] }): Promise<{ scheduled: number }>
  cancelHeadPops(): Promise<void>
  testHeadPop(options: { seconds: number }): Promise<{ at: number; exact: boolean }>
  fcmToken(): Promise<{ token: string | null; available: boolean }>
  takePendingSay(): Promise<{ message: string | null }>
  setPopsEnabled(options: { enabled: boolean }): Promise<void>
}

/** One moment at which Emergy should appear and say something. */
export type HeadPop = {
  id: number
  at: number       // epoch ms
  message: string
}

/**
 * The chat head — the Messenger kind, which is a different mechanism from a
 * bubble despite looking the same in a screenshot.
 *
 * A bubble is a notification the system may choose to float; Samsung's One UI
 * does not implement them at all, so on those phones a correct bubble is still
 * just a notification. A head is a window the app draws itself, which works
 * everywhere and costs the "display over other apps" permission.
 */
export type HeadStatus = {
  granted: boolean   // the user has allowed drawing over other apps
  running: boolean   // a head is on screen right now
}

const plugin = registerPlugin<EmergyBubblePlugin>("EmergyBubble")

export async function bubbleAvailability(): Promise<BubbleAvailability> {
  const none: BubbleAvailability = { available: false, allowed: false, preference: "unknown", sdk: 0 }
  if (!Capacitor.isNativePlatform()) return none
  try {
    const a = await plugin.isAvailable()
    // An APK built before the tri-state shipped answers without it. Say
    // "unknown" rather than inventing a state the phone never reported.
    return { ...a, preference: a.preference ?? "unknown" }
  } catch {
    // An APK older than the plugin: absent, not broken.
    return none
  }
}

/** Float Emergy over whatever is on screen, saying something. */
export async function showBubble(message: string): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return "Bubbles only work in the Android app."
  try {
    await plugin.show({ message })
    return null
  } catch (e) {
    // The reason reaches the user: "nothing happened" is the failure this
    // project keeps finding, and a bubble that silently declines to appear is
    // indistinguishable from one that is broken.
    return e instanceof Error ? e.message : "Couldn't show the bubble."
  }
}

/**
 * Ask the phone whether the last bubble actually floated.
 *
 * Worth a short wait first: the system sets the flag when it posts, and
 * reading it back the same tick races that.
 */
export async function bubbleOutcome(): Promise<BubbleOutcome | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    return await plugin.didBubble()
  } catch {
    // Older APK, or the read failed. We don't know — which is not the same
    // as "it didn't", and the UI says so.
    return null
  }
}

/** Android's own bubble screen for this app. Beats directions we can't see. */
export async function openBubbleSettings(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    await plugin.openSettings()
    return true
  } catch {
    return false
  }
}

export async function hideBubble(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try { await plugin.hide() } catch { /* nothing to hide */ }
}

/** Whether we may float a head, and whether one is up. */
export async function headStatus(): Promise<HeadStatus | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    return await plugin.headStatus()
  } catch {
    // An APK from before the head existed. Absent, not off.
    return null
  }
}

/**
 * Open the phone's "display over other apps" screen for this app.
 *
 * There is no runtime dialog for this one — it cannot be requested in a
 * prompt, only switched on by hand — so pointing at the exact screen is the
 * whole of what an app is allowed to do.
 */
export async function requestOverlayPermission(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try { await plugin.requestOverlay() } catch { /* screen unavailable */ }
}

/** Float him. Returns a reason when it couldn't, never a silent no-op. */
export async function startHead(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return "The chat head only works in the Android app."
  try {
    await plugin.startHead()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : "Couldn't start the chat head."
  }
}

export async function stopHead(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try { await plugin.stopHead() } catch { /* nothing running */ }
}

/** Whether reminders should pop the head out. Off unless switched on. */
const POP_KEY = "eh_head_pops"
const POP_COUNT_KEY = "eh_head_pops_count"

export function headPopsEnabled(): boolean {
  if (typeof localStorage === "undefined") return false
  return localStorage.getItem(POP_KEY) === "1"
}

export function setHeadPopsEnabled(on: boolean): void {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(POP_KEY, on ? "1" : "0")
}

/**
 * Lay down the alarms that pop Emergy out when a reminder comes due.
 *
 * Replaces the whole set each time rather than adding to it — the same
 * contract the notification scheduler works to, so a reminder deleted on the
 * web cannot survive as an alarm on the phone.
 */
export async function scheduleHeadPops(pops: HeadPop[]): Promise<number | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    if (!headPopsEnabled()) { await plugin.cancelHeadPops(); return 0 }
    const res = await plugin.scheduleHeadPops({ pops })
    const n = res?.scheduled ?? 0
    // Kept so the settings card can say how many are armed. "Switched on" and
    // "actually has alarms" are different facts, and only the second one means
    // anything will happen.
    remember(String(n))
    return n
  } catch {
    // An APK from before this existed. Recorded as its own state, not as
    // zero: "your app build can't do this yet" and "you have nothing with a
    // time on it" both mean nothing pops, and they need opposite answers.
    remember("unavailable")
    return null
  }
}

function remember(value: string): void {
  try { localStorage.setItem(POP_COUNT_KEY, value) } catch { /* private mode */ }
}

/**
 * How many pops the last sync armed — or null when this app build has no
 * chat-head plugin to arm them with.
 */
export async function headPopCount(): Promise<number | null> {
  try {
    const raw = localStorage.getItem(POP_COUNT_KEY)
    if (raw === "unavailable") return null
    return Number(raw ?? "0") || 0
  } catch {
    return 0
  }
}

/**
 * Fire one pop a few seconds from now, through the real alarm.
 *
 * The point is to leave the app before it lands. Whether Android permits this
 * app to raise a window from the background, and whether the phone's battery
 * manager sat on the alarm, cannot be read off any code — only watched. A
 * shortcut that showed the head directly would prove neither.
 */
export async function testHeadPop(seconds = 12): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return "Only in the Android app."
  try {
    const res = await plugin.testHeadPop({ seconds })
    return res?.exact === false
      ? "Set, but not to the exact second — \"Alarms & reminders\" is off for this app, so it may land late."
      : null
  } catch (e) {
    return e instanceof Error ? e.message : "Couldn't set the test."
  }
}

/**
 * Register this device for native push.
 *
 * Web push already delivers Emergy's messages, but only to a browser, and a
 * service worker cannot raise the chat head — it has no bridge to native code.
 * This is the path that can.
 *
 * Returns what happened, because "no token" and "server has no Firebase set
 * up" and "registered" all look identical from the outside otherwise.
 */
export async function registerNativePush(): Promise<"registered" | "no-token" | "not-configured" | "unreachable" | "off-device"> {
  if (!Capacitor.isNativePlatform()) return "off-device"
  try {
    const { token, available } = await plugin.fcmToken()
    if (!available || !token) return "no-token"
    const res = await fetch("/api/push/fcm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
    // Distinct from "no-token": the phone HAS a token and Firebase is in the
    // build — we just couldn't hand it over. Telling someone their app was
    // built without Firebase because the server returned a 500 sends them off
    // to fix the wrong thing entirely.
    if (!res.ok) return "unreachable"
    const json = await res.json().catch(() => ({}))
    return json?.configured === false ? "not-configured" : "registered"
  } catch {
    // An APK built without Firebase. Absent, not broken.
    return "no-token"
  }
}

/**
 * Mirror the pop-out preference into native storage.
 *
 * The toggle lives in localStorage, which a push service waking with no
 * WebView cannot read. Without this, a message arriving while the app is
 * closed has no way to know whether popping was wanted.
 */
export async function setNativePopsEnabled(enabled: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try { await plugin.setPopsEnabled({ enabled }) } catch { /* older APK */ }
}


/**
 * What Emergy popped up to say, if it has not been collected yet.
 *
 * The head speaks while the app is closed, so the sentence lives in the
 * phone's own storage until something opens and asks for it. Reading it
 * clears it: it is a handover, not a mailbox, and a message collected twice
 * would start the same conversation twice.
 *
 * Deliberately NOT a URL parameter. The text would then be attacker-supplied
 * to a page whose job is to render it as something Emergy said — and this app
 * talks about medication. Coming out of native storage, the only thing that
 * can put words in his mouth is the app itself.
 */
export async function takePendingSay(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const { message } = await plugin.takePendingSay()
    const trimmed = typeof message === "string" ? message.trim() : ""
    return trimmed || null
  } catch {
    // An APK older than this method. Nothing pending, as far as we can tell.
    return null
  }
}
