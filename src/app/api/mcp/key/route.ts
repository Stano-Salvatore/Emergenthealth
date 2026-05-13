import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { randomBytes } from "crypto"

// GET /api/mcp/key — list all API keys for the signed-in user
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const keys = await prisma.mcpApiKey.findMany({
    where: { userId: session.user.id },
    select: { id: true, name: true, createdAt: true, token: true },
    orderBy: { createdAt: "desc" },
  })

  // Mask the token for listing — only show first/last 4 chars
  return NextResponse.json(
    keys.map((k) => ({
      ...k,
      tokenPreview: `${k.token.slice(0, 8)}...${k.token.slice(-4)}`,
      token: undefined,
    })),
  )
}

// POST /api/mcp/key — create a new API key
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = (body.name as string) || "Default"

  const token = `mcp_fit_${randomBytes(32).toString("hex")}`

  const key = await prisma.mcpApiKey.create({
    data: { userId: session.user.id, token, name },
  })

  // Return the full token once — it cannot be retrieved again
  return NextResponse.json({ id: key.id, name: key.name, token, createdAt: key.createdAt })
}

// DELETE /api/mcp/key?id=<id> — revoke an API key
export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const id = new URL(req.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

  await prisma.mcpApiKey.deleteMany({ where: { id, userId: session.user.id } })
  return NextResponse.json({ deleted: true })
}
