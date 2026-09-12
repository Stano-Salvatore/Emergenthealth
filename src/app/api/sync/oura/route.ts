import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { syncOuraForUser } from "@/lib/oura-sync"

export const maxDuration = 120 // nine Oura endpoints for a 30-day window

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Deliberately does NOT recordSync. AutoSync fires this on every app open,
  // so writing a status line here would keep "last synced" minutes fresh
  // whatever the scheduled job is doing — and the one thing the sync screen
  // exists to catch is a scheduled job that has stopped running. The cron is
  // the only writer, so a silence there stays visible as a silence.
  const result = await syncOuraForUser(session.user.id)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      // Not-connected is a normal state, not a server fault. AutoSync fires
      // this on every app open on the documented promise that unconnected
      // services answer "with a quick 4xx" — a 503 here put a phantom server
      // error in the console of every user who simply doesn't own the ring.
      { status: result.notConnected ? 400 : 500 },
    )
  }

  return NextResponse.json({
    success: true,
    synced: result.synced,
    tagsSynced: result.tagsSynced,
    ...(result.tagsError ? { tagsError: result.tagsError } : {}),
  })
}
