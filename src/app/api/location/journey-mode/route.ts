// "That was a bus, not a car."
//
// A GPS trace cannot tell a bus from a car — they use the same roads at the
// same speeds — so lib/day-journeys labels those moves as a guess and says so.
// This is how a guess becomes a fact: the user taps the mode and picks the
// right one, and from then on that segment is labelled "known".
//
// Stored as a UserPreference keyed by the local day and the segment's start
// instant. The segments themselves are derived from raw points on every read,
// so there is no row to attach this to — and re-deriving them yields the same
// start instants, which is what makes the key stable.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isCorrectableMode, modeFixKey } from "@/lib/day-journeys"
import { getUserTimezone } from "@/lib/user-timezone"
import { localDateStr } from "@/lib/local-date"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null) as
    { date?: string; start?: string; mode?: string } | null
  if (!body) return NextResponse.json({ error: "bad body" }, { status: 400 })

  // The day the segment is filed under, which is the user's day and not UTC's.
  // Defaulting to today would file a correction made after midnight against
  // the wrong date and lose it, so an explicit date must look like one.
  const timezone = await getUserTimezone(userId)
  const date = body.date ?? localDateStr(timezone)
  if (!DATE_RE.test(date)) return NextResponse.json({ error: "bad date" }, { status: 400 })

  const startMs = Date.parse(body.start ?? "")
  if (!Number.isFinite(startMs)) return NextResponse.json({ error: "bad start" }, { status: 400 })
  const start = new Date(startMs).toISOString()

  const key = modeFixKey(date, start)

  // An empty mode clears the correction and lets inference speak again —
  // otherwise a mistaken correction would be permanent.
  if (body.mode === "" || body.mode == null) {
    await prisma.userPreference.delete({ where: { userId_key: { userId, key } } }).catch(() => null)
    return NextResponse.json({ ok: true, mode: null })
  }

  if (!isCorrectableMode(body.mode)) return NextResponse.json({ error: "bad mode" }, { status: 400 })

  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key } },
    create: { userId, key, value: body.mode },
    update: { value: body.mode },
  })

  return NextResponse.json({ ok: true, mode: body.mode })
}
