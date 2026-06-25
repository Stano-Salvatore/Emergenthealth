// Called by Chrome Custom Tab (via /mobile-signin redirect) to kick off Google
// OAuth. We construct the authorization URL manually and set the
// __Secure-authjs.callback-url cookie ourselves so Auth.js's callback redirects
// Chrome to the bridge after OAuth completes.
//
// The previous approach (calling Auth() internally and returning its response)
// should have worked, but something in the Next.js / Vercel response pipeline
// was stripping or not propagating the Set-Cookie header reliably.  By owning
// the entire Response we guarantee Chrome receives exactly the cookie we want.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const authKey = url.searchParams.get("auth_key") ?? ""
  const origin = url.origin

  const callbackUrl = `${origin}/api/mobile-auth-bridge${
    authKey ? `?auth_key=${encodeURIComponent(authKey)}` : ""
  }`

  // Build the Google OAuth authorization URL with the same params that
  // next-auth's Google provider uses (access_type + prompt ensure a refresh
  // token is returned on every consent).
  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  googleAuthUrl.searchParams.set("client_id", process.env.AUTH_GOOGLE_ID!)
  googleAuthUrl.searchParams.set("response_type", "code")
  // redirect_uri must match an entry registered in Google Cloud Console
  googleAuthUrl.searchParams.set("redirect_uri", `${origin}/api/auth/callback/google`)
  googleAuthUrl.searchParams.set(
    "scope",
    [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/sdm.service",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/gmail.readonly",
    ].join(" ")
  )
  googleAuthUrl.searchParams.set("access_type", "offline")
  googleAuthUrl.searchParams.set("prompt", "consent")

  // Auth.js's vendored cookie serializer (cookie.ts) uses encodeURIComponent
  // for cookie values; its parser uses decodeURIComponent.  We mirror that
  // encoding here so the callback handler reads the value correctly.
  const headers = new Headers()
  headers.set("Location", googleAuthUrl.toString())
  headers.append(
    "Set-Cookie",
    `__Secure-authjs.callback-url=${encodeURIComponent(callbackUrl)}; Path=/; HttpOnly; Secure; SameSite=Lax`
  )

  return new Response(null, { status: 302, headers })
}
