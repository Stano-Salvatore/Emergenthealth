import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { ingestLocationPoints } from "@/lib/location-ingest"

export const runtime = "nodejs"
export const maxDuration = 30

// The native location service's door.
//
// EmergyLocationService runs in the Android process with no WebView and no
// session cookie — that is the whole point of it, it keeps going after the
// app is closed and after a restart. What it does have is the widget key the
// app stores for the home-screen widgets, so it identifies itself the way
// they do. Same rows, same ids, same visit detection as the session route.

async function resolveUserByApiKey(apiKey: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "UserPreference"
    WHERE "key" = 'widget_api_key' AND "value" = ${apiKey}
    LIMIT 1
  `.catch(() => [] as { userId: string }[])
  return rows[0]?.userId ?? null
}

export async function POST(req: NextRequest) {
  const apiKey =
    req.headers.get("x-widget-key") ??
    new URL(req.url).searchParams.get("key") ??
    ""
  if (!apiKey) return NextResponse.json({ error: "Missing API key" }, { status: 401 })

  const userId = await resolveUserByApiKey(apiKey)
  if (!userId) return NextResponse.json({ error: "Invalid API key" }, { status: 401 })

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
