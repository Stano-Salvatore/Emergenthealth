import { type NextRequest, NextResponse } from "next/server"
import { NextSSETransport } from "@/lib/mcp-transport"
import { createHealthMcpServer } from "@/lib/mcp-health-server"

// Keep the SSE stream alive for up to 60 s on Hobby / 300 s on Pro.
// Claude.ai will reconnect automatically if the session expires.
export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  // Optional: protect with a bearer token set in Claude.ai connector settings.
  const readKey = process.env.MCP_READ_API_KEY
  if (readKey) {
    const auth = req.headers.get("authorization") ?? ""
    if (auth !== `Bearer ${readKey}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const transport = new NextSSETransport("/api/mcp/messages")
  const server = createHealthMcpServer()
  await server.connect(transport)

  return new Response(transport.readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
