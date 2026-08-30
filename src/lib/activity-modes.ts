// Travel modes from sources that actually know, mapped into this app's words.
//
// The day journey infers modes from GPS speed, which cannot tell a bus from a
// car — they drive the same roads at the same speeds. Two sources do better:
//
//   Google Timeline's activity segments. Google matches movement against
//   transit-line maps, which is how it can say IN_BUS or IN_TRAM rather than
//   just "in a vehicle" — the one distinction no phone sensor makes.
//
//   Android's Activity Recognition transitions, from the phone's own
//   accelerometer and gyroscope, fused at OS level. These separate walking,
//   running, cycling and "in a vehicle" cleanly — and stop there, honestly:
//   IN_VEHICLE is all the sensors can say, so it maps to a vehicleOnly span
//   that refines the journey's guess without asserting bus or car.
//
// Everything here is pure so the mappings and the transition pairing can be
// tested without a phone or an export file.

import type { TravelMode } from "@/lib/day-journeys"

export interface ModeSpan {
  start: Date
  end: Date
  mode: TravelMode
  /** True when the source could only say "in a vehicle". */
  vehicleOnly: boolean
}

/**
 * Google Timeline activity types, as they appear in every export shape.
 *
 * Absent from this map means "we have no word for it and will not pretend":
 * SKIING, SAILING, IN_FERRY and friends produce no span rather than a wrong
 * one. IN_VEHICLE (Google's own fallback when its map-matching gave up) keeps
 * the bus/car question open, exactly like the phone's sensors.
 */
const GOOGLE_ACTIVITY_MODES: Record<string, { mode: TravelMode; vehicleOnly?: boolean }> = {
  WALKING: { mode: "walk" },
  RUNNING: { mode: "run" },
  CYCLING: { mode: "cycle" },
  IN_BUS: { mode: "transit" },
  IN_TRAM: { mode: "transit" },
  IN_SUBWAY: { mode: "train" },
  IN_TRAIN: { mode: "train" },
  IN_PASSENGER_VEHICLE: { mode: "drive" },
  MOTORCYCLING: { mode: "drive" },
  FLYING: { mode: "flight" },
  IN_VEHICLE: { mode: "drive", vehicleOnly: true },
}

export function googleActivityMode(type: string): { mode: TravelMode; vehicleOnly: boolean } | null {
  const hit = GOOGLE_ACTIVITY_MODES[type.trim().toUpperCase()]
  return hit ? { mode: hit.mode, vehicleOnly: hit.vehicleOnly ?? false } : null
}

/**
 * Android DetectedActivity type codes, from the Activity Recognition API.
 * STILL (3) is deliberately absent: the journey's own stop detection owns
 * "not moving", and a STILL span overriding a stay would say nothing new.
 */
const ANDROID_ACTIVITY_MODES: Record<number, { mode: TravelMode; vehicleOnly?: boolean }> = {
  0: { mode: "drive", vehicleOnly: true }, // IN_VEHICLE
  1: { mode: "cycle" },                    // ON_BICYCLE
  2: { mode: "walk" },                     // ON_FOOT
  7: { mode: "walk" },                     // WALKING
  8: { mode: "run" },                      // RUNNING
}

/** One transition event as the phone reports it. */
export interface TransitionEvent {
  /** DetectedActivity type code. */
  type: number
  /** 0 = ENTER, 1 = EXIT — ActivityTransition's own encoding. */
  transition: number
  /** Epoch milliseconds. */
  at: number
}

/**
 * A missed EXIT must not become an endless span. Six hours is longer than any
 * real bus ride and shorter than "the OS dropped the exit event overnight and
 * tomorrow's walk to work is now part of yesterday's drive".
 */
export const MAX_TRANSITION_SPAN_MS = 6 * 60 * 60 * 1000

/** Shorter than this is sensor flutter at a traffic light, not travel. */
const MIN_TRANSITION_SPAN_MS = 60 * 1000

/**
 * Pair ENTER/EXIT transition events into spans.
 *
 * Events may arrive out of order across drain batches, so they are sorted
 * first. An ENTER with no EXIT is closed by the next ENTER of a different
 * activity (the phone moved on to something else) or dropped at the cap —
 * never left open, because an open-ended claim about where someone was is
 * worse than no claim.
 */
export function pairTransitions(events: TransitionEvent[]): ModeSpan[] {
  const sorted = [...events]
    .filter(e => Number.isFinite(e.at) && e.at > 0)
    .sort((a, b) => a.at - b.at)

  const spans: ModeSpan[] = []
  let open: { type: number; at: number } | null = null

  const close = (endMs: number) => {
    if (!open) return
    const mapped = ANDROID_ACTIVITY_MODES[open.type]
    const length = endMs - open.at
    if (mapped && length >= MIN_TRANSITION_SPAN_MS && length <= MAX_TRANSITION_SPAN_MS) {
      spans.push({
        start: new Date(open.at),
        end: new Date(endMs),
        mode: mapped.mode,
        vehicleOnly: mapped.vehicleOnly ?? false,
      })
    }
    open = null
  }

  for (const e of sorted) {
    if (e.transition === 0) {
      // A new ENTER ends whatever was running: the phone is only ever doing
      // one of these at a time.
      if (open && open.type !== e.type) close(e.at)
      if (!open || open.type !== e.type) open = { type: e.type, at: e.at }
    } else if (e.transition === 1) {
      if (open && open.type === e.type) close(e.at)
    }
  }

  return spans
}

/** Deterministic row id, so re-importing or re-draining the same span is a no-op. */
export function spanId(userId: string, source: string, startMs: number, mode: string): string {
  return `as_${source}_${userId.slice(-8)}_${startMs}_${mode}`
}
