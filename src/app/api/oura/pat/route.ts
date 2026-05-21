import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const token = typeof body?.token === "string" ? body.token.trim() : ""
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 })

  // Validate token against Oura API before storing
  const check = await fetch("https://api.ouraring.com/v2/usercollection/personal_info", {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!check.ok) {
    return NextResponse.json({ error: "Oura rejected the token — check it and try again" }, { status: 400 })
  }

  await prisma.ouraToken.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      accessToken: token,
      refreshToken: null,
      expiresAt: null,
      scope: "personal daily heartrate workout session spo2",
    },
    update: {
      accessToken: token,
      refreshToken: null,
      expiresAt: null,
    },
  })

  return NextResponse.json({ success: true })
}
