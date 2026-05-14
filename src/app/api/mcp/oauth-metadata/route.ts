import { NextRequest } from "next/server"

export const runtime = "nodejs"

// OAuth 2.0 Authorization Server Metadata (RFC 8414)
// Claude.ai mobile discovers this to find the authorization and token endpoints.
export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin
  return Response.json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/authorize`,
    token_endpoint: `${origin}/api/mcp/token`,
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
    grant_types_supported: ["authorization_code", "client_credentials"],
    response_types_supported: ["code", "token"],
    code_challenge_methods_supported: ["S256", "plain"],
  })
}
