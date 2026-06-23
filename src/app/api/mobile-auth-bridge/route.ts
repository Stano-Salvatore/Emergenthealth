import { cookies } from "next/headers"

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

  const params = new URLSearchParams({
    token: sessionCookie.value,
    name: cookieName,
  })

  const target = `emergenthealth://auth?${params.toString()}`

  // 1. window.location.replace fires the Android intent automatically (fast path).
  // 2. The visible "Open Emergenthealth" link is the 100%-reliable fallback:
  //    a physical tap on <a href="emergenthealth://..."> always triggers the
  //    Android intent system even if the programmatic JS redirect was blocked.
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
    .logo{width:64px;height:64px;background:linear-gradient(135deg,#6c63ff,#4f46e5);
      border-radius:16px;display:flex;align-items:center;justify-content:center}
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
  <div class="logo">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
      stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  </div>
  <h1>Signed in!</h1>
  <p>Opening Emergenthealth…<br/>If the app doesn't open automatically, tap below.</p>
  <a class="btn" href="${target}">Open Emergenthealth →</a>
  <script>window.location.replace(${JSON.stringify(target)})</script>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  )
}
