import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getStoredToken, startTimer } from "@/lib/toggl"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const stored = await getStoredToken(session.user.id)
  if (!stored?.workspaceId) return NextResponse.json({ error: "Toggl not connected" }, { status: 503 })

  const { description, projectId } = await req.json()

  try {
    const entry = await startTimer(stored.apiToken, stored.workspaceId, description ?? "", projectId ?? null)
    return NextResponse.json({ entry })
  } catch (e) {
    console.error("[toggl/start]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
