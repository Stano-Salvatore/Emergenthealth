// Where the phone's own sensors land.
//
// Four signals arrive together because they are drained together: ambient
// light and barometric pressure, screen and charge moments, and the Sleep
// API's segments. None of them cost a permission the app did not already
// hold — the point of doing them in one pass.
//
// The client clears its buffers as it hands them over, so a request that
// succeeded but whose response was lost takes the data with it. Deterministic
// ids are the other half of that: every row here is keyed by what it IS, so a
// retry writes the same rows twice and the database keeps one. Neither
// mechanism is trusted alone — a handover that drops data and a duplicate that
// doubles it are both one failure away, and they fail in opposite directions.

import { NextRequest, NextResponse } from "next/server"
import { createHash } from "node:crypto"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

/** Generous for a fortnight of backlog, and a hard ceiling on one request. */
const MAX_ROWS = 4000

/** A clock claiming the future, or the deep past, is a broken clock. */
const FUTURE_SLACK_MS = 60_000
const OLDEST_MS = 90 * 24 * 60 * 60 * 1000

const KINDS = new Set(["screen_on", "screen_off", "unlock", "charge_on", "charge_off"])

/**
 * Physically possible readings only.
 *
 * Direct sun is around 100,000 lux and a sensor reporting more than that is
 * reporting a fault. Pressure on the surface of the earth has never been
 * recorded outside roughly 850–1100 hPa at sea level, and this is station
 * pressure, so the floor allows for altitude — La Paz sits near 640.
 */
const plausibleLux = (v: number) => v >= 0 && v <= 150_000
const plausiblePressure = (v: number) => v >= 500 && v <= 1100

const rowId = (userId: string, kind: string, at: number, extra = "") =>
  createHash("sha256").update(`${userId}:${kind}:${at}:${extra}`).digest("hex").slice(0, 32)

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null) as {
    ambient?: unknown; phoneEvents?: unknown; sleep?: unknown
  } | null
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 })

  const now = Date.now()
  const inWindow = (at: number) => at <= now + FUTURE_SLACK_MS && at >= now - OLDEST_MS

  // ── Ambient ───────────────────────────────────────────────────────────────
  const ambient: { id: string; userId: string; at: Date; lux: number | null; pressureHpa: number | null }[] = []
  if (Array.isArray(body.ambient)) {
    for (const r of body.ambient.slice(0, MAX_ROWS)) {
      const row = r as { at?: unknown; lux?: unknown; pressureHpa?: unknown }
      const at = num(row?.at)
      if (at === null || !inWindow(at)) continue
      let lux = num(row?.lux)
      let pressureHpa = num(row?.pressureHpa)
      // A reading outside physical possibility is dropped, not clamped:
      // clamping invents a number the sensor never gave.
      if (lux !== null && !plausibleLux(lux)) lux = null
      if (pressureHpa !== null && !plausiblePressure(pressureHpa)) pressureHpa = null
      if (lux === null && pressureHpa === null) continue
      ambient.push({ id: rowId(userId, "ambient", at), userId, at: new Date(at), lux, pressureHpa })
    }
  }

  // ── Screen and charge ─────────────────────────────────────────────────────
  const events: { id: string; userId: string; at: Date; kind: string }[] = []
  if (Array.isArray(body.phoneEvents)) {
    for (const r of body.phoneEvents.slice(0, MAX_ROWS)) {
      const row = r as { at?: unknown; kind?: unknown }
      const at = num(row?.at)
      const kind = String(row?.kind ?? "")
      if (at === null || !inWindow(at) || !KINDS.has(kind)) continue
      // Two different kinds can share a millisecond (screen on, then unlock),
      // so the kind is part of the identity — otherwise the second overwrites
      // the first and a pickup becomes invisible.
      events.push({ id: rowId(userId, kind, at), userId, at: new Date(at), kind })
    }
  }

  // ── Sleep the phone guessed ───────────────────────────────────────────────
  const sleep: { id: string; userId: string; start: Date; end: Date; status: number }[] = []
  if (Array.isArray(body.sleep)) {
    for (const r of body.sleep.slice(0, MAX_ROWS)) {
      const row = r as { start?: unknown; end?: unknown; status?: unknown }
      const start = num(row?.start)
      const end = num(row?.end)
      if (start === null || end === null || end <= start || !inWindow(start)) continue
      // Nobody sleeps for 24 hours, and a segment that claims it is a bug in
      // the detector rather than a night worth keeping.
      if (end - start > 24 * 60 * 60 * 1000) continue
      sleep.push({
        id: rowId(userId, "sleep", start, String(end)),
        userId,
        start: new Date(start),
        end: new Date(end),
        status: num(row?.status) ?? 0,
      })
    }
  }

  const [a, e, s] = await Promise.all([
    ambient.length
      ? prisma.ambientSample.createMany({ data: ambient, skipDuplicates: true })
      : Promise.resolve({ count: 0 }),
    events.length
      ? prisma.phoneEvent.createMany({ data: events, skipDuplicates: true })
      : Promise.resolve({ count: 0 }),
    sleep.length
      ? prisma.phoneSleepSegment.createMany({ data: sleep, skipDuplicates: true })
      : Promise.resolve({ count: 0 }),
  ])

  // What arrived and what was new, per POST. Without this line a morning
  // brief that says "no sleep data" cannot be told apart from a night the
  // Sleep API never delivered — the request was a 200 either way.
  const received = (v: unknown) => (Array.isArray(v) ? v.length : 0)
  console.log(
    `[phone-sensors] user=${userId} ambient=${a.count}/${received(body.ambient)} ` +
    `events=${e.count}/${received(body.phoneEvents)} sleep=${s.count}/${received(body.sleep)} (new/received)`,
  )

  return NextResponse.json({ ok: true, ambient: a.count, phoneEvents: e.count, sleep: s.count })
}
