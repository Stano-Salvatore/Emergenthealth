import { cookies } from "next/headers"

// Called by Chrome Custom Tab after successful Google OAuth.
// Reads the NextAuth session token from the request cookies (Chrome has it),
// then uses a JS redirect to the emergenthealth:// custom scheme so Android
// hands the URL to our app. The app extracts the token, sets it as a cookie
// in the WebView's CookieManager, and navigates to /dashboard.
//
// JS redirect (not HTTP 302) is used because Chrome blocks server-side 302
// redirects to custom URI schemes as a security measure, but allows
// JS-initiated navigations which are delegated to the Android intent system.
export async function GET(request: Request) {
  const cookieStore = await cookies()

  // NextAuth v5 uses __Secure- prefix on HTTPS (production), plain name on HTTP (dev)
  const secureCookie = cookieStore.get("__Secure-authjs.session-token")
  const insecureCookie = cookieStore.get("authjs.session-token")
  const sessionCookie = secureCookie ?? insecureCookie

  if (!sessionCookie) {
    return Response.redirect(new URL("/signin?error=OAuthCallback", request.url))
  }

  const cookieName = secureCookie
    ? "__Secure-authjs.session-token"
    : "authjs.session-token"

  const params = new URLSearchParams({
    token: sessionCookie.value,
    name: cookieName,
  })

  const target = `emergenthealth://auth?${params.toString()}`
  return new Response(
    `<!DOCTYPE html><html><head><title>Opening app…</title></head><body>
<script>window.location.replace(${JSON.stringify(target)})</script>
<p>Returning to app…</p></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  )
}
