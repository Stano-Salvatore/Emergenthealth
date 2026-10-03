import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { checkRateLimit, clientIp } from "@/lib/rate-limit"
import { redeemMcpCode } from "@/lib/mcp-oauth-code"

export const runtime = "nodejs"

// OAuth 2.0 token endpoint.
// Supports both authorization_code and client_credentials grants; either way
// the access token handed back is the user's MCP key. An authorization code
// is a one-time grant from /api/mcp/authorize (lib/mcp-oauth-code), redeemed
// only with the PKCE verifier it was asked for with — never the key itself.
export async function POST(req: NextRequest) {
  // Unauthenticated by nature and it validates secrets: cap guesses per address.
  const rl = checkRateLimit(clientIp(req), "mcp_token", 30, 10 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ error: "slow_down", error_description: "Too many token requests" }, { status: 429 })
  }

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

  if (grantType === "authorization_code") {
    const code = params.get("code")
    if (!code) {
      return Response.json({ error: "invalid_request", error_description: "code is required" }, { status: 400 })
    }
    const keyId = await redeemMcpCode(code, {
      verifier: params.get("code_verifier"),
      redirectUri: params.get("redirect_uri"),
    }).catch(() => null)
    const key = keyId ? await prisma.mcpApiKey.findUnique({ where: { id: keyId } }).catch(() => null) : null
    if (!key) {
      // RFC 6749 §5.2: a bad, spent, expired or mismatched code is invalid_grant, status 400.
      return Response.json({ error: "invalid_grant", error_description: "Unknown, used or expired code" }, { status: 400 })
    }
    return Response.json({ access_token: key.token, token_type: "bearer", expires_in: 86400 })
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
