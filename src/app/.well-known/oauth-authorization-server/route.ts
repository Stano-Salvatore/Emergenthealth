import { NextRequest } from "next/server"

export const runtime = "nodejs"

// OAuth 2.0 Authorization Server Metadata (RFC 8414)
// Claude.ai mobile discovers this to find the token endpoint before
// making MCP requests. The token endpoint accepts the MCP API key as
// client_secret and returns it as a Bearer access_token.
export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin
  return Response.json({
    issuer: origin,
    token_endpoint: `${origin}/api/mcp/token`,
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    grant_types_supported: ["client_credentials"],
    response_types_supported: ["token"],
  })
}
