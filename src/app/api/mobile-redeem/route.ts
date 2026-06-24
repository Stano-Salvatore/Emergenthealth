import { createHmac } from "crypto"
import { prisma } from "@/lib/prisma"

// Called by the native WebView after the app resumes from Chrome Custom Tab.
// The native app generated a UUID (auth_key) before opening Chrome; the bridge
// stored the signed session code under that key. This endpoint retrieves it,
// validates the HMAC, sets the session cookie, and redirects to /dashboard.
//
// This eliminates the deep-link dependency: even if Chrome blocks the custom-
// scheme intent URI, onResume() loads this URL and authentication completes.
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key")

  if (!key) {
    return Response.redirect(new URL("/signin?error=MissingKey", request.url))
  }

  const record = await prisma.verificationToken.findFirst({
    where: {
      identifier: `mobile-auth:${key}`,
      expires: { gt: new Date() },
    },
  })

  if (!record) {
    return Response.redirect(new URL("/signin?error=AuthKeyNotFound", request.url))
  }

  // Delete the record so it can only be redeemed once
  await prisma.verificationToken.deleteMany({
    where: { identifier: `mobile-auth:${key}` },
  })

  const code = record.token
  const tildeIdx = code.lastIndexOf("~")
  if (tildeIdx === -1) {
    return Response.redirect(new URL("/signin?error=BadCode", request.url))
  }

  const payload = code.slice(0, tildeIdx)
  const sig = code.slice(tildeIdx + 1)
  const secret = process.env.AUTH_SECRET!
  const expected = createHmac("sha256", secret).update(payload).digest("base64url")

  if (sig !== expected) {
    return Response.redirect(new URL("/signin?error=BadCode", request.url))
  }

  let data: { t: string; n: string; x: number }
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString())
  } catch {
    return Response.redirect(new URL("/signin?error=BadCode", request.url))
  }

  if (Date.now() > data.x) {
    return Response.redirect(new URL("/signin?error=ExpiredCode", request.url))
  }

  const headers = new Headers({
    "Set-Cookie": `${data.n}=${data.t}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000`,
    Location: new URL("/dashboard", request.url).toString(),
  })

  return new Response(null, { status: 302, headers })
}
