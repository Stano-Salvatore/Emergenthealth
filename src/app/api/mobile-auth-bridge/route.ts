import { cookies } from "next/headers"

// Called by Chrome Custom Tab after successful Google OAuth.
// Reads the NextAuth session token from the request cookies (Chrome has it),
// then redirects to the emergenthealth:// custom scheme so Android hands the
// URL to our app. The app extracts the token, sets it as a cookie in the
// WebView's CookieManager, and navigates to /dashboard.
//
// Custom schemes (unlike App Links) are always delegated by Chrome to the
// registered app — no domain verification needed.
export async function GET(request: Request) {
  const cookieStore = await cookies()

  // NextAuth v5 uses __Secure- prefix on HTTPS (production), plain name on HTTP (dev)
  const secureCookie = cookieStore.get("__Secure-authjs.session-token")
  const insecureCookie = cookieStore.get("authjs.session-token")
  const sessionCookie = secureCookie ?? insecureCookie

  if (!sessionCookie) {
    return Response.redirect(new URL("/signin", request.url))
  }

  const cookieName = secureCookie
    ? "__Secure-authjs.session-token"
    : "authjs.session-token"

  const params = new URLSearchParams({
    token: sessionCookie.value,
    name: cookieName,
  })

  return Response.redirect(`emergenthealth://auth?${params.toString()}`)
}
