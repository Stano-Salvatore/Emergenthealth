import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { syncOuraForUser } from "@/lib/oura-sync"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const result = await syncOuraForUser(session.user.id)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.notConnected ? 503 : 500 },
    )
  }

  return NextResponse.json({ success: true, synced: result.synced, tagsSynced: result.tagsSynced })
}
