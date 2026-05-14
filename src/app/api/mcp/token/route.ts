import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

// OAuth 2.0 token endpoint.
// Supports both authorization_code and client_credentials grants.
// In both cases the MCP API key IS the token — we just validate it exists.
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? ""

  let params: URLSearchParams
  if (contentType.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(await req.text())
  } else {
    const body = await req.json().catch(() => ({}))
    params = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)]))
  }

  // Also check HTTP Basic auth header for client_secret
  const basicAuth = req.headers.get("authorization") ?? ""
  if (basicAuth.startsWith("Basic ") && !params.get("client_secret")) {
    const decoded = Buffer.from(basicAuth.slice(6), "base64").toString()
    const secret = decoded.split(":")[1]
    if (secret) params.set("client_secret", secret)
  }

  const grantType = params.get("grant_type")

  // authorization_code: the "code" is the MCP key (issued by /api/mcp/authorize)
  if (grantType === "authorization_code") {
    const code = params.get("code")
    if (!code) {
      return Response.json({ error: "invalid_request", error_description: "code is required" }, { status: 400 })
    }
    const key = await prisma.mcpApiKey.findUnique({ where: { token: code } }).catch(() => null)
    if (!key) {
      return Response.json({ error: "invalid_grant", error_description: "Unknown code" }, { status: 401 })
    }
    return Response.json({ access_token: code, token_type: "bearer", expires_in: 86400 })
  }

  // client_credentials: client_secret is the MCP key
  if (!grantType || grantType === "client_credentials") {
    const clientSecret = params.get("client_secret")
    if (!clientSecret) {
      return Response.json({ error: "invalid_client", error_description: "client_secret is required" }, { status: 401 })
    }
    const key = await prisma.mcpApiKey.findUnique({ where: { token: clientSecret } }).catch(() => null)
    if (!key) {
      return Response.json({ error: "invalid_client", error_description: "Unknown client_secret" }, { status: 401 })
    }
    return Response.json({ access_token: clientSecret, token_type: "bearer", expires_in: 86400 })
  }

  return Response.json({ error: "unsupported_grant_type" }, { status: 400 })
}
