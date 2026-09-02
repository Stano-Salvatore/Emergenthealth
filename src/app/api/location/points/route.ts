import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { ingestLocationPoints } from "@/lib/location-ingest"

export const runtime = "nodejs"
export const maxDuration = 30

// The WebView uploader's door.
//
// OwnTracks posts to /api/location/track with an API key because it is a
// separate app that knows nothing about the session. This is our own app, so it
// posts a batch on the session cookie instead — no key to paste, nothing to
// leak, and the user never has to set anything up beyond one toggle. The
// native service, which has no session, uses /api/widget/location; both end
// in lib/location-ingest.

/**
 * When the server last heard anything, and how much of today it has.
 *
 * Tracking failing looks exactly like tracking working: the notification stays
 * up, the switch still says "Stop following along", and the points simply stop.
 * Today's first real journey logged sixteen fixes on a bus and then nothing for
 * forty minutes of sitting still, and the only reason anyone noticed was a
 * screenshot of the map. The app should be able to say it itself.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const newest = await prisma.locationPoint.findFirst({
    where: { userId, source: "app" },
    orderBy: { trackedAt: "desc" },
    select: { trackedAt: true },
  }).catch(() => null)

  const since = new Date(Date.now() - 24 * 60 * 60_000)
  const recent = await prisma.locationPoint.count({
    where: { userId, source: "app", trackedAt: { gte: since } },
  }).catch(() => 0)

  return NextResponse.json({
    lastPointAt: newest?.trackedAt?.toISOString() ?? null,
    lastDayCount: recent,
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  let body: { points?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!Array.isArray(body.points) || body.points.length === 0) {
    return NextResponse.json({ error: "No points" }, { status: 400 })
  }

  const result = await ingestLocationPoints(userId, body.points)
  return NextResponse.json({ ok: true, ...result })
}
