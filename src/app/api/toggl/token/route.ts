import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getStoredToken, saveToken, deleteToken, verifyToken } from "@/lib/toggl"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const stored = await getStoredToken(session.user.id)
  if (!stored) return NextResponse.json({ connected: false })

  return NextResponse.json({
    connected: true,
    workspaceId: stored.workspaceId,
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { apiToken } = await req.json()
  if (!apiToken?.trim()) return NextResponse.json({ error: "API token required" }, { status: 400 })

  try {
    const user = await verifyToken(apiToken.trim())
    await saveToken(session.user.id, apiToken.trim(), user.default_workspace_id)
    return NextResponse.json({ connected: true, workspaceId: user.default_workspace_id, name: user.fullname })
  } catch (e) {
    return NextResponse.json({ error: "Invalid Toggl API token" }, { status: 400 })
  }
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  await deleteToken(session.user.id)
  return NextResponse.json({ connected: false })
}
