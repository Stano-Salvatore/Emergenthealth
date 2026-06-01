import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { syncYnabForUser } from "@/lib/ynab-sync"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const result = await syncYnabForUser(session.user.id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, synced: result.synced, deleted: result.deleted })
}
