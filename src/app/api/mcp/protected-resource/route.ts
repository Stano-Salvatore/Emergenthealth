import { NextRequest } from "next/server"

export const runtime = "nodejs"

// OAuth 2.0 Protected Resource Metadata (RFC 9728)
// Claude.ai uses this to discover which authorization server protects this resource.
export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin
  return Response.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/api/mcp`,
  })
}
