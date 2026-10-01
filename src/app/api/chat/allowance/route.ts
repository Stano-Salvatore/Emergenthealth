import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { emergyAllowance } from "@/lib/emergy-quota"

export const dynamic = "force-dynamic"

// Today's Emergy allowance, read without spending any. { allowance: null } is
// the owner, who has no limit — and nothing to show under the chat box.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const allowance = await emergyAllowance(session.user.id).catch(() => null)
  return NextResponse.json({ allowance })
}
