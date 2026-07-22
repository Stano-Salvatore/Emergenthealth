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
    // Surface the real reason (usually a Resend config issue: missing API key,
    // or the shared onboarding@resend.dev sender only being allowed to email the
    // Resend account's own address) instead of a generic 500, so it's actionable.
    const message = err instanceof Error ? err.message : "Failed to send digest email."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
