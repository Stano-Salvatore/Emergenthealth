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

export type BubbleAvailability = {
  available: boolean   // the OS can do this at all
  allowed: boolean     // and the user has not switched bubbles off for us
  sdk: number
}

type EmergyBubblePlugin = {
  isAvailable(): Promise<BubbleAvailability>
  show(options: { message: string }): Promise<void>
  hide(): Promise<void>
}

const plugin = registerPlugin<EmergyBubblePlugin>("EmergyBubble")

export async function bubbleAvailability(): Promise<BubbleAvailability> {
  if (!Capacitor.isNativePlatform()) return { available: false, allowed: false, sdk: 0 }
  try {
    return await plugin.isAvailable()
  } catch {
    // An APK older than the plugin: absent, not broken.
    return { available: false, allowed: false, sdk: 0 }
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

export async function hideBubble(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try { await plugin.hide() } catch { /* nothing to hide */ }
}
