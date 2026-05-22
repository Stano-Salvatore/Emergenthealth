import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getGmailSummary } from "@/lib/gmail"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const data = await getGmailSummary(session.user.id)
  return NextResponse.json(data)
}
