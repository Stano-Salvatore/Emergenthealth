// The phone's store-and-forward buffers, and the one place they are emptied.
//
// Four sensor signals and the activity transitions are collected natively
// while the web layer does not exist, parked in SharedPreferences, and handed
// over when something asks. For a release the only things that asked were two
// cards on the Settings screen — so light, pressure, screen moments, the
// Sleep API's nights and the travel modes reached the server only on the days
// the user happened to open Settings. Everything else waited, and past each
// buffer's cap the oldest rows went quietly. The phone-sleep fallback shipped
// in 3.3.4 read a table that, for anyone who never visited Settings, stayed
// empty on exactly the nights it was built for.
//
// So the drain lives here, called from NativeBridge on every foreground as
// well as from the cards. Both are no-ops on the web, where the drains return
// nothing.
//
// Draining clears the native buffer before the upload is acknowledged, so
// each stream saves what it drained to Preferences BEFORE the POST and clears
// it only on a 2xx. A failed POST — airplane mode at wake-up, a 401 from a
// page left open past its session, a 5xx — is sent again on the next
// foreground, merged with whatever was drained since. The routes key rows
// deterministically, so a re-send that did land the first time is a no-op.
//
// The activity stream also keeps its still-open tail (see openTail): a
// journey in progress when the app is opened has only its ENTER in this
// drain, and the EXIT comes in a later one.
//
// And the drain has to finish before the brief asks about last night. The
// dashboard layout mounts the brief inside the page and NativeBridge after
// it, so React ran the brief's effect first: every cold open asked the
// server before the drain had begun, and on a ring-off night the answer —
// "no sleep data" — was cached for the rest of the morning while the phone's
// segments landed a second later. waitForPhoneDrain() is the brief's side of
// that: on the web it is nothing, on the phone it holds for the drain that
// is running or about to run, bounded so a plugin that never answers cannot
// hide the brief.

import { Capacitor } from "@capacitor/core"
import { Preferences } from "@capacitor/preferences"
import { drainActivityEvents, drainSensorData, sampleAmbient } from "@/lib/native/bubble"
import { openTail } from "@/lib/activity-modes"

/** Long enough for a plugin call and one POST on a slow radio; short enough not to look broken. */
export const DRAIN_WAIT_MS = 4000

let inFlight: Promise<void> | null = null
let drainedOnce = false
const waiters: (() => void)[] = []

/** Ships both buffers. The one call NativeBridge makes on mount and on every foreground. */
export function drainPhone(): Promise<void> {
  const run = Promise.all([
    uploadPhoneSensors().catch(() => 0),
    uploadActivityEvents().catch(() => 0),
  ]).then(() => {
    drainedOnce = true
    if (inFlight === run) inFlight = null
    for (const w of waiters.splice(0)) w()
  })
  inFlight = run
  return run
}

/**
 * Resolves once the phone's buffers have reached the server, or after
 * `timeoutMs`, whichever is first. Immediate on the web. Waits for a drain
 * in flight; with none in flight, immediate after the first completed drain
 * of this page load, and otherwise waits for one to start.
 */
export function waitForPhoneDrain(timeoutMs = DRAIN_WAIT_MS): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve()
  if (!inFlight && drainedOnce) return Promise.resolve()
  const drained = inFlight ?? new Promise<void>(resolve => { waiters.push(resolve) })
  const deadline = new Promise<void>(resolve => { setTimeout(resolve, timeoutMs) })
  return Promise.race([drained, deadline])
}

const OWED_SENSORS = "phone_sensors_owed"
const OWED_ACTIVITY = "activity_events_owed"
const ACTIVITY_CARRY = "activity_events_carry"
/** The routes' own per-request ceiling; past it the oldest go. */
const CAP = 4000

async function readSaved<T>(key: string): Promise<T | null> {
  try {
    const { value } = await Preferences.get({ key })
    return value ? JSON.parse(value) as T : null
  } catch {
    return null
  }
}

/** A saved list, or none. Anything else in storage is dropped rather than thrown on every foreground. */
const listOf = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : [])

async function save(key: string, value: unknown): Promise<void> {
  try {
    if (value == null) await Preferences.remove({ key })
    else await Preferences.set({ key, value: JSON.stringify(value) })
  } catch { /* best effort: the POST still goes */ }
}

/**
 * One run at a time per stream. NativeBridge and a Settings card can both
 * call in; two overlapping runs would each read the saved batch, and one
 * could clear it while the other's POST was failing.
 */
function oneAtATime<T>(fn: () => Promise<T>): () => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve()
  return () => {
    const run = chain.then(fn, fn)
    chain = run.catch(() => {})
    return run
  }
}

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null)

/** Reads the light/pressure sensors once, then ships every queued sample, screen moment and sleep segment. Returns rows the server took. */
export const uploadPhoneSensors = oneAtATime(async (): Promise<number> => {
  await sampleAmbient()
  const fresh = await drainSensorData()
  const owed = await readSaved<Partial<Record<keyof typeof fresh, unknown>>>(OWED_SENSORS)
  const data = {
    ambient: [...listOf<typeof fresh.ambient[number]>(owed?.ambient), ...fresh.ambient].slice(-CAP),
    phoneEvents: [...listOf<typeof fresh.phoneEvents[number]>(owed?.phoneEvents), ...fresh.phoneEvents].slice(-CAP),
    sleep: [...listOf<typeof fresh.sleep[number]>(owed?.sleep), ...fresh.sleep].slice(-CAP),
  }
  const total = data.ambient.length + data.phoneEvents.length + data.sleep.length
  if (total === 0) return 0
  await save(OWED_SENSORS, data)
  const res = await post("/api/phone/sensors", data)
  if (!res?.ok) return 0
  await save(OWED_SENSORS, null)
  return total
})

type Transition = Awaited<ReturnType<typeof drainActivityEvents>>[number]

/** Ships the activity-recognition transitions recorded while the app was closed. Returns rows the server took. */
export const uploadActivityEvents = oneAtATime(async (): Promise<number> => {
  const fresh = await drainActivityEvents()
  const owed = listOf<Transition>(await readSaved(OWED_ACTIVITY))
  // Nothing new and nothing failed: the carried tail alone cannot pair, so
  // it waits for the next drain rather than going up by itself.
  if (fresh.length === 0 && owed.length === 0) return 0
  const carry = listOf<Transition>(await readSaved(ACTIVITY_CARRY))
  const events = [...carry, ...owed, ...fresh].sort((a, b) => a.at - b.at).slice(-CAP)
  await save(OWED_ACTIVITY, events)
  await save(ACTIVITY_CARRY, null)
  const res = await post("/api/activity/transitions", { events })
  if (!res?.ok) return 0
  await save(OWED_ACTIVITY, null)
  const tail = openTail(events, Date.now())
  await save(ACTIVITY_CARRY, tail.length ? tail : null)
  return events.length
})
