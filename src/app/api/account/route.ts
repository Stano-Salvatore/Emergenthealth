import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { deleteAccount } from "@/lib/account-deletion"
import { NextResponse } from "next/server"

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  // All or nothing, and never reported as done when it wasn't: the person is
  // signed out on success and cannot come back to check what was left behind.
  try {
    await deleteAccount(prisma, userId)
  } catch (e) {
    console.error("[account] delete failed:", e)
    return NextResponse.json({ error: "Your account could not be deleted. Nothing was removed — please try again." }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
