import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getSmartDevices, executeCommand } from "@/lib/google-home"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const devices = await getSmartDevices(session.user.id)
    return NextResponse.json({ devices })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const isPermission = msg === "PERMISSION_DENIED" || msg.includes("403")
    return NextResponse.json(
      { error: msg, needsReauth: isPermission },
      { status: isPermission ? 403 : 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { deviceName, command, params } = await req.json()
    await executeCommand(session.user.id, deviceName, command, params)
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
