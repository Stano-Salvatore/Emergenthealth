import { auth } from "@/auth"
import { NextResponse } from "next/server"
import { getGoals, saveGoals } from "@/lib/goals"

// Goals live in the UserGoals table; @/lib/goals owns reading, validating and
// migrating them. This route is just the HTTP end of it.

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json(await getGoals(session.user.id))
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const patch = await req.json().catch(() => null)
  if (!patch || typeof patch !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  // The saved goals come back, so a client that sent something out of range
  // sees what was actually stored rather than assuming it took.
  return NextResponse.json(await saveGoals(session.user.id, patch))
}
