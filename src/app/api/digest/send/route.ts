import { auth } from "@/auth"
import { NextResponse } from "next/server"
import { sendDigestForUser } from "@/lib/digest"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const email = session.user.email
  if (!email) {
    return NextResponse.json({ error: "No email on account" }, { status: 400 })
  }

  try {
    await sendDigestForUser(session.user.id, email)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[digest] Unexpected error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
