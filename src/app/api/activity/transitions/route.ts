// Where the phone's motion transitions become travel-mode spans.
//
// The native receiver catches "ENTERED walking / EXITED a vehicle" moments
// while the app is closed; the web layer drains them on foreground and posts
// them here raw. Pairing ENTER with EXIT happens server-side in
// lib/activity-modes, where the logic is pure and tested — pairing on the
// phone would mean logic that can only be debugged on a phone.
//
// Deterministic span ids make a duplicate drain (a request that succeeded but
// whose response was lost, so the client retries) a no-op rather than the
// same journey twice.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { pairTransitions, spanId, type TransitionEvent } from "@/lib/activity-modes"

export const runtime = "nodejs"

/** A week of dense city movement is a few hundred; this is a hard ceiling. */
const MAX_EVENTS = 4000

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null) as { events?: unknown } | null
  if (!body || !Array.isArray(body.events)) {
    return NextResponse.json({ error: "events required" }, { status: 400 })
  }

  const now = Date.now()
  const events: TransitionEvent[] = []
  for (const e of body.events.slice(0, MAX_EVENTS)) {
    const type = Number((e as { type?: unknown })?.type)
    const transition = Number((e as { transition?: unknown })?.transition)
    const at = Number((e as { at?: unknown })?.at)
    if (!Number.isFinite(type) || !Number.isFinite(transition) || !Number.isFinite(at)) continue
    // A clock that claims the future, or the distant past, is a broken clock.
    if (at > now + 60_000 || at < now - 90 * 24 * 60 * 60 * 1000) continue
    events.push({ type, transition, at })
  }

  const spans = pairTransitions(events)
  if (spans.length === 0) return NextResponse.json({ ok: true, spans: 0 })

  const res = await prisma.activitySpan.createMany({
    data: spans.map(s => ({
      id: spanId(userId, "phone", s.start.getTime(), s.mode),
      userId,
      start: s.start,
      end: s.end,
      mode: s.mode,
      vehicleOnly: s.vehicleOnly,
      source: "phone",
    })),
    skipDuplicates: true,
  })

  return NextResponse.json({ ok: true, spans: res.count })
}
