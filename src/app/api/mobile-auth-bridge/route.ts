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
    JSON.stringify({ t: sessionCookie.value, n: cookieName, x: Date.now() + 600_000 })
  ).toString("base64url")
  const sig = createHmac("sha256", secret).update(payload).digest("base64url")
  const code = `${payload}~${sig}`

  // Chrome Custom Tab blocks window.location.replace("customscheme://...")
  // without a user gesture. Chrome's intent:// URI scheme is explicitly
  // allowed without a user gesture and fires the Android intent directly.
  const encodedCode = encodeURIComponent(code)
  const intentTarget = `intent://auth?code=${encodedCode}#Intent;scheme=emergenthealth;package=app.emergenthealth;end`
  const fallbackTarget = `emergenthealth://auth?code=${encodedCode}`

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
    p{color:#888;font-size:14px;text-align:center;max-width:280px;line-height:1.6}
    a.btn{display:flex;align-items:center;justify-content:center;
      background:#6c63ff;color:#fff;border-radius:14px;
      padding:20px 36px;font-size:18px;font-weight:700;
      text-decoration:none;min-width:240px;
      box-shadow:0 4px 24px rgba(108,99,255,0.5)}
    .sub{color:#666;font-size:12px;margin-top:8px}
  </style>
</head>
<body>
  <h1>Signed in!</h1>
  <p>Tap the button below to open the app.</p>
  <a class="btn" id="openBtn" href="${intentTarget}">Open Emergenthealth →</a>
  <p class="sub">If the button doesn't work, close this tab and reopen the app.</p>
  <script>
    // intent:// URI fires immediately without needing a user gesture in Chrome.
    window.location.replace(${JSON.stringify(intentTarget)});
    // Fallback after 1s: try the raw custom scheme
    setTimeout(function(){
      try { window.location.replace(${JSON.stringify(fallbackTarget)}); } catch(e){}
    }, 1000);
  </script>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  )
}
