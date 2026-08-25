import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { fcmConfigured, saveFcmToken } from "@/lib/fcm"

export const runtime = "nodejs"

// Where the Android app registers for native push.
//
// Web push already reaches a browser, but a service worker cannot raise the
// chat head — it has no bridge to native code. This path lands in the app's
// own process, which is the only place something can.

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // Whether the server could send at all, so the app can say "not set up on
  // this server" rather than registering into a void.
  return NextResponse.json({ configured: fcmConfigured() })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { token } = await req.json().catch(() => ({})) as { token?: unknown }
  if (typeof token !== "string" || token.length < 20) {
    return NextResponse.json({ error: "token required" }, { status: 400 })
  }

  try {
    await saveFcmToken(session.user.id, token)
    return NextResponse.json({ ok: true, configured: fcmConfigured() })
  } catch {
    return NextResponse.json({ error: "Couldn't register this device" }, { status: 500 })
  }
}
