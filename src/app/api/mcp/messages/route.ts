import { type NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/mcp-transport"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"

export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId")
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 })
  }

  const transport = getSession(sessionId)
  if (!transport) {
    return NextResponse.json({ error: "Session not found or expired" }, { status: 404 })
  }

  let body: JSONRPCMessage
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  transport.deliver(body)
  return NextResponse.json({ ok: true })
}
