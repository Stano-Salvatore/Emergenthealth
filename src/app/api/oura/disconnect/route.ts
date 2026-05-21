import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    await prisma.ouraToken.delete({
      where: { userId: session.user.id },
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[oura/disconnect] error:", err)
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 })
  }
}
