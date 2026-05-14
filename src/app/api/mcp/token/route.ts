import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

// OAuth 2.0 token endpoint — client_credentials grant only.
// Claude.ai mobile posts here with the MCP API key as client_secret
// and gets back a standard Bearer access_token response.
export async function POST(req: NextRequest) {
  let clientSecret: string | null = null

  const contentType = req.headers.get("content-type") ?? ""

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const body = await req.text()
    const params = new URLSearchParams(body)
    clientSecret = params.get("client_secret")

    // Also support HTTP Basic auth (client_id:client_secret)
    if (!clientSecret) {
      const auth = req.headers.get("authorization") ?? ""
      if (auth.startsWith("Basic ")) {
        const decoded = Buffer.from(auth.slice(6), "base64").toString()
        clientSecret = decoded.split(":")[1] ?? null
      }
    }
  } else {
    // JSON body fallback
    const body = await req.json().catch(() => ({}))
    clientSecret = body.client_secret ?? null
  }

  if (!clientSecret) {
    return Response.json(
      { error: "invalid_client", error_description: "client_secret is required" },
      { status: 401 },
    )
  }

  // Validate that client_secret is a real MCP API key
  const key = await prisma.mcpApiKey.findUnique({ where: { token: clientSecret } })
  if (!key) {
    return Response.json(
      { error: "invalid_client", error_description: "Unknown client_secret" },
      { status: 401 },
    )
  }

  // Return the key itself as the Bearer access_token — our MCP route
  // already validates Bearer tokens against the McpApiKey table.
  return Response.json({
    access_token: clientSecret,
    token_type: "bearer",
    expires_in: 86400,
  })
}
