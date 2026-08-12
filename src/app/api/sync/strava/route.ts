import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { syncStravaForUser } from "@/lib/strava-sync"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const result = await syncStravaForUser(session.user.id)
  if (!result.ok) {
    console.error("[sync/strava] error:", result.error)
    const status = result.notConnected ? 400 : 502
    return NextResponse.json({ error: result.error }, { status })
  }

  return NextResponse.json({ synced: result.synced })
}
