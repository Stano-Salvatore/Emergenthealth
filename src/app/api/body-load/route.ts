import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { computeBodyLoad } from "@/lib/body-load-now"

// The computation lives in lib/body-load-now so the chat's scripted "what's
// still in me" answer reads the same numbers this tab does.

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json(await computeBodyLoad(session.user.id))
}
