import { createHmac } from "crypto"

// Called by the native app after receiving the emergenthealth://auth?code=...
// deep link. The WebView navigates here; we validate the signed code and
// respond with Set-Cookie + 302 → /dashboard.
//
// This approach is 100% reliable: the session cookie is set by a standard
// HTTP Set-Cookie response header, which the WebView stores automatically.
// No CookieManager.setCookie() calls needed on the native side.
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code")

  if (!code) {
    return Response.redirect(new URL("/signin?error=MissingCode", request.url))
  }

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
