import { createHmac } from "crypto"
import { prisma } from "@/lib/prisma"

// Called by the native WebView (via loadUrl) after the app resumes from the
// Chrome Custom Tab that handled Google OAuth.
//
// Returns 200 (not 302) with a Set-Cookie header. Android WebView correctly
// processes Set-Cookie headers from 2xx responses and stores them in its
// cookie jar. It silently drops Set-Cookie from 3xx redirect responses —
// that is why the previous /api/mobile-redeem (302 + Set-Cookie) did not work.
//
// The HTML body does a <meta> refresh to /dashboard so the next request
// automatically carries the newly set session cookie.
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

  const cookieStr = `${data.n}=${data.t}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000`

  // Return 200 with Set-Cookie. A meta http-equiv="refresh" with delay=0 can
  // race against Android WebView's async cookie write; use a JS setTimeout so
  // the cookie is committed before the navigation fires.
  return new Response(
    `<!DOCTYPE html><html><head></head><body><script>setTimeout(function(){window.location.replace('/dashboard')},300);</script></body></html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": cookieStr,
        "Cache-Control": "no-store",
      },
    }
  )
}
