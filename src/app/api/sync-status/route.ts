import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { loadSyncOverview } from "@/lib/sync-status-load"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json(await loadSyncOverview(session.user.id))
}
