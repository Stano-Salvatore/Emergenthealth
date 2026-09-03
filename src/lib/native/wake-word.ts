import { Capacitor, registerPlugin } from "@capacitor/core"

// Listening for his name.
//
// Milestone one shipped everything except the detector: the service, its
// survival across the app closing and the phone restarting, the charging
// rule, and the handoff into dictation. Milestone two put sherpa-onnx behind
// it — Apache 2.0 and open-vocabulary, so the phrase is a text file rather
// than a model somebody has to train, which is what makes it shippable to
// other people. `hasDetector` says whether this APK carries the model;
// `engine` says what is actually behind the microphone once something has
// listened. An APK from before milestone two reports hasDetector false and
// every surface still says so.

export type WakeStatus = {
  available: boolean
  /** Whether this APK carries the recognition model at all. */
  hasDetector: boolean
  /** "sherpa" once real ears fed a frame, "stub" if it fell back, "" before either. Absent on older APKs. */
  engine?: "sherpa" | "stub" | ""
  /**
   * Why the microphone is shut when it should be open — a permission never
   * granted, a mic another app holds, a recogniser that failed to load. "" when
   * nothing is wrong; absent on an APK from before this existed.
   */
  error?: string
  running: boolean
  /** The microphone is actually open right now (charging-only can pause it). */
  listening: boolean
  keep: boolean
  chargingOnly: boolean
  pluggedIn: boolean
  microphone: boolean
  batteryUnrestricted: boolean
}

type WakePlugin = {
  wakeStatus(): Promise<WakeStatus>
  startWake(): Promise<void>
  stopWake(): Promise<void>
  setWakeChargingOnly(options: { enabled: boolean }): Promise<void>
  testWakeFire(): Promise<void>
  takePendingWake(): Promise<{ heard: boolean }>
}

const plugin = registerPlugin<WakePlugin>("EmergyBubble")

/** Null on the web, and on an APK built before the service existed. */
export async function wakeStatus(): Promise<WakeStatus | null> {
  if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return null
  if (!Capacitor.isPluginAvailable("EmergyBubble")) return null
  try {
    const s = await plugin.wakeStatus()
    return s?.available ? s : null
  } catch {
    return null
  }
}

export async function startWake(): Promise<"started" | "denied" | "unavailable"> {
  if ((await wakeStatus()) === null) return "unavailable"
  try {
    await plugin.startWake()
    return "started"
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return /NOT_AUTHORIZED|denied|permission/i.test(msg) ? "denied" : "unavailable"
  }
}

export async function stopWake(): Promise<void> {
  if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return
  try { await plugin.stopWake() } catch { /* older build, or nothing running */ }
}

export async function setWakeChargingOnly(enabled: boolean): Promise<void> {
  if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return
  try { await plugin.setWakeChargingOnly({ enabled }) } catch { /* older build */ }
}

/** Pretend the wake word was heard — the only way to test the chain with no model. */
export async function testWakeFire(): Promise<void> {
  if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return
  try { await plugin.testWakeFire() } catch { /* older build */ }
}

/**
 * Did the service hear the name while we were away? Drained once, and only
 * counted if it was recent — opening the microphone because of something said
 * an hour ago would be alarming rather than helpful.
 */
export async function takePendingWake(): Promise<boolean> {
  if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return false
  try {
    const { heard } = await plugin.takePendingWake()
    return !!heard
  } catch {
    return false
  }
}
