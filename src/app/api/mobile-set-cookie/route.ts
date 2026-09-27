import { prisma } from "@/lib/prisma"
import { checkRateLimit, clientIp } from "@/lib/rate-limit"
import { isAuthKey, mayRedeemFrom, verifySessionCode } from "@/lib/session-code"

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
  const ip = clientIp(request)
  const { allowed } = checkRateLimit(ip, "mobile_set_cookie", 20, 10 * 60 * 1000)
  if (!allowed) return Response.redirect(new URL("/signin?error=MobileTooManyAttempts", request.url))

  const key = new URL(request.url).searchParams.get("key")
  if (!isAuthKey(key)) {
    return Response.redirect(new URL("/signin?error=MissingKey", request.url))
  }

  const identifier = `mobile-auth:${key}`
  const record = await prisma.verificationToken.findFirst({
    where: { identifier, expires: { gt: new Date() } },
  })
  if (!record) {
    // Key already redeemed (double-intent race) — cookie was set by the first call.
    // Redirect to dashboard; if not authenticated, Next.js will redirect to /signin.
    return Response.redirect(new URL("/dashboard", request.url))
  }

  const data = verifySessionCode(record.token)
  if (!data) {
    await prisma.verificationToken.deleteMany({ where: { identifier } })
    return Response.redirect(new URL("/signin?error=BadCode", request.url))
  }

  // Refused without consuming the row: a stranger holding the key must not be
  // able to burn the real phone's redeem either. Sent to /signin rather than
  // answered in plain text: this runs inside the app's WebView, which has no
  // address bar, and a phone that changed network mid-sign-in needs a way on.
  if (!mayRedeemFrom(data, ip)) {
    return Response.redirect(new URL("/signin?error=MobileOtherNetwork", request.url))
  }

  // One redemption per key; a concurrent redeem that lost the race finds nothing to delete.
  const { count } = await prisma.verificationToken.deleteMany({ where: { identifier } })
  if (count === 0) return Response.redirect(new URL("/dashboard", request.url))

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
