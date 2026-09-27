import { NextRequest, NextResponse } from "next/server"
import { widgetKeyUser } from "@/lib/widget-key"
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

export async function POST(req: NextRequest) {
  const apiKey =
    req.headers.get("x-widget-key") ??
    new URL(req.url).searchParams.get("key") ??
    ""
  if (!apiKey) return NextResponse.json({ error: "Missing API key" }, { status: 401 })

  const who = await widgetKeyUser(apiKey)
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status })
  const userId = who.userId

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
