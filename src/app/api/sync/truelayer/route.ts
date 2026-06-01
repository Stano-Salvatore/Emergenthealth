import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { syncTruelayerForUser } from "@/lib/truelayer-sync"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const result = await syncTruelayerForUser(session.user.id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, synced: result.synced, deleted: result.deleted })
}
