import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

// OAuth 2.0 Authorization Endpoint for Claude.ai mobile.
// Claude.ai redirects the user here; we check their NextAuth session,
// find their most-recent MCP key, and redirect back with it as the
// authorization code. The token endpoint then echoes it as access_token.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const redirectUri = searchParams.get("redirect_uri")
  const state = searchParams.get("state")

  if (!redirectUri) {
    return Response.json({ error: "invalid_request", error_description: "redirect_uri is required" }, { status: 400 })
  }

  const session = await auth()
  if (!session?.user?.id) {
    // Not logged in — send user to sign-in, then come back here
    const loginUrl = new URL("/signin", req.url)
    loginUrl.searchParams.set("callbackUrl", req.url)
    return NextResponse.redirect(loginUrl)
  }

  const key = await prisma.mcpApiKey.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  }).catch(() => null)

  const callback = new URL(redirectUri)
  if (state) callback.searchParams.set("state", state)

  if (!key) {
    callback.searchParams.set("error", "access_denied")
    callback.searchParams.set("error_description", "No MCP API key found — create one in Settings first.")
    return NextResponse.redirect(callback.toString())
  }

  callback.searchParams.set("code", key.token)
  return NextResponse.redirect(callback.toString())
}
