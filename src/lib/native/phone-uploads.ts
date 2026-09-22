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
// Draining clears the native buffer before the upload is acknowledged, so a
// failed POST loses that batch — the same trade the cards already made, and
// the reason the route keys rows deterministically (a retry can double, a
// handover can drop, and neither is trusted alone). Pushing a failed batch
// back to the phone would need a plugin method, which costs an APK.

import { drainActivityEvents, drainSensorData, sampleAmbient } from "@/lib/native/bubble"

/** Reads the light/pressure sensors once, then ships every queued sample, screen moment and sleep segment. Returns rows sent. */
export async function uploadPhoneSensors(): Promise<number> {
  await sampleAmbient()
  const data = await drainSensorData()
  const total = data.ambient.length + data.phoneEvents.length + data.sleep.length
  if (total === 0) return 0
  await fetch("/api/phone/sensors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).catch(() => null)
  return total
}

/** Ships the activity-recognition transitions recorded while the app was closed. Returns rows sent. */
export async function uploadActivityEvents(): Promise<number> {
  const events = await drainActivityEvents()
  if (events.length === 0) return 0
  await fetch("/api/activity/transitions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events }),
  }).catch(() => null)
  return events.length
}
