import { cookies } from "next/headers"
import { createHmac } from "crypto"
import { prisma } from "@/lib/prisma"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const authKey = url.searchParams.get("auth_key") ?? ""

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

  const secret = process.env.AUTH_SECRET!
  const expiresAt = Date.now() + 600_000 // 10 minutes
  const payload = Buffer.from(
    JSON.stringify({ t: sessionCookie.value, n: cookieName, x: expiresAt })
  ).toString("base64url")
  const sig = createHmac("sha256", secret).update(payload).digest("base64url")
  const code = `${payload}~${sig}`

  // Store the signed code in the database keyed by auth_key.
  // The native app retrieves it via /api/mobile-redeem when it resumes —
  // no deep-link callback needed from Chrome to the app.
  if (authKey) {
    await prisma.verificationToken.upsert({
      where: { identifier_token: { identifier: `mobile-auth:${authKey}`, token: code } },
      create: {
        identifier: `mobile-auth:${authKey}`,
        token: code,
        expires: new Date(expiresAt),
      },
      update: { token: code, expires: new Date(expiresAt) },
    })
  }

  // Also try the intent URI in case it works (belt-and-suspenders).
  // The app handles it in onNewIntent(); if Chrome blocks it, onResume() picks
  // up the code from the database instead.
  const encodedCode = encodeURIComponent(code)
  const intentTarget = authKey
    ? `intent://auth?key=${encodeURIComponent(authKey)}#Intent;scheme=emergenthealth;package=app.emergenthealth;end`
    : `intent://auth?code=${encodedCode}#Intent;scheme=emergenthealth;package=app.emergenthealth;end`
  const fallbackTarget = authKey
    ? `emergenthealth://auth?key=${encodeURIComponent(authKey)}`
    : `emergenthealth://auth?code=${encodedCode}`

  return new Response(
    `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Signed in!</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;flex-direction:column;align-items:center;
      justify-content:center;gap:20px;background:#0f0e1a;
      font-family:-apple-system,sans-serif;padding:24px;text-align:center}
    h1{color:#fff;font-size:22px;font-weight:700}
    p{color:#aaa;font-size:15px;max-width:280px;line-height:1.6}
    .arrow{color:#6c63ff;font-size:32px;margin:4px 0}
    a.btn{display:flex;align-items:center;justify-content:center;
      background:#6c63ff;color:#fff;border-radius:14px;
      padding:18px 36px;font-size:17px;font-weight:700;
      text-decoration:none;min-width:240px;
      box-shadow:0 4px 24px rgba(108,99,255,0.5)}
    .sub{color:#555;font-size:12px}
  </style>
</head>
<body>
  <h1>You're signed in!</h1>
  <div class="arrow">↓</div>
  <p>Close this tab and return to the Emergenthealth app — it will open your dashboard automatically.</p>
  <a class="btn" href="${intentTarget}">Return to app</a>
  <p class="sub">Or just close this tab manually.</p>
  <script>
    window.location.replace(${JSON.stringify(intentTarget)});
    setTimeout(function(){
      try { window.location.replace(${JSON.stringify(fallbackTarget)}); } catch(e){}
    }, 800);
  </script>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  )
}
