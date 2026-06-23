import { cookies } from "next/headers"
import { createHmac } from "crypto"

export async function GET(request: Request) {
  const cookieStore = await cookies()

  const secureCookie = cookieStore.get("__Secure-authjs.session-token")
  const insecureCookie = cookieStore.get("authjs.session-token")
  const sessionCookie = secureCookie ?? insecureCookie

  if (!sessionCookie) {
    return Response.redirect(new URL("/signin?error=OAuthCallback", request.url))
  }

  const cookieName = secureCookie
    ? "__Secure-authjs.session-token"
    : "authjs.session-token"

  // Sign the session token so the exchange endpoint can verify it without a
  // database round-trip. The native app loads /api/mobile-exchange?code=...
  // in the WebView; the server sets the cookie via Set-Cookie response header
  // (standard HTTP — no CookieManager.setCookie() needed).
  const secret = process.env.AUTH_SECRET!
  const payload = Buffer.from(
    JSON.stringify({ t: sessionCookie.value, n: cookieName, x: Date.now() + 120_000 })
  ).toString("base64url")
  const sig = createHmac("sha256", secret).update(payload).digest("base64url")
  const code = `${payload}~${sig}`

  const target = `emergenthealth://auth?code=${encodeURIComponent(code)}`

  return new Response(
    `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Opening Emergenthealth…</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;flex-direction:column;align-items:center;
      justify-content:center;gap:28px;background:#0f0e1a;
      font-family:-apple-system,sans-serif;padding:24px}
    h1{color:#fff;font-size:20px;font-weight:700}
    p{color:#888;font-size:14px;text-align:center;max-width:260px;line-height:1.5}
    a.btn{display:flex;align-items:center;justify-content:center;
      background:#6c63ff;color:#fff;border-radius:14px;
      padding:16px 36px;font-size:16px;font-weight:700;
      text-decoration:none;min-width:220px;
      box-shadow:0 4px 24px rgba(108,99,255,0.5)}
  </style>
</head>
<body>
  <h1>Signed in!</h1>
  <p>Opening Emergenthealth…<br/>If the app doesn't open automatically, tap below.</p>
  <a class="btn" href="${target}">Open Emergenthealth →</a>
  <script>window.location.replace(${JSON.stringify(target)})</script>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  )
}
