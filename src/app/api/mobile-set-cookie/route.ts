import { prisma } from "@/lib/prisma"
import { isAuthKey, verifySessionCode } from "@/lib/session-code"

// Called by the native WebView (via loadUrl) after the app resumes from the
// Chrome Custom Tab that handled Google OAuth.
//
// Returns 200 (not 302) with a Set-Cookie header. Android WebView correctly
// processes Set-Cookie headers from 2xx responses and stores them in its
// cookie jar. It silently drops Set-Cookie from 3xx redirect responses —
// which is why the earlier 302-based redeem route never worked.
//
// The body does a delayed JS navigation to /dashboard so the next request
// carries the newly set session cookie.
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key")
  if (!isAuthKey(key)) {
    return Response.redirect(new URL("/signin?error=MissingKey", request.url))
  }

  const record = await prisma.verificationToken.findFirst({
    where: { identifier: `mobile-auth:${key}`, expires: { gt: new Date() } },
  })
  if (!record) {
    // Key already redeemed (double-intent race) — cookie was set by the first call.
    // Redirect to dashboard; if not authenticated, Next.js will redirect to /signin.
    return Response.redirect(new URL("/dashboard", request.url))
  }

  // One redemption per key.
  await prisma.verificationToken.deleteMany({ where: { identifier: `mobile-auth:${key}` } })

  const data = verifySessionCode(record.token)
  if (!data) {
    return Response.redirect(new URL("/signin?error=BadCode", request.url))
  }

  const cookieStr = `${data.n}=${data.t}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000`

  // A meta refresh with delay=0 can race Android WebView's async cookie write;
  // a JS setTimeout lets the cookie commit before the navigation fires.
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
