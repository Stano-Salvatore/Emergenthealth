import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { loadLabTrends } from "@/lib/lab-trends-load"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    return NextResponse.json(await loadLabTrends(session.user.id))
  } catch (e) {
    console.error("[labs/trends] error:", e)
    return NextResponse.json({ error: "Failed to load trends" }, { status: 500 })
  }
}
