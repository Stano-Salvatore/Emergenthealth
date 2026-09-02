import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { isAuthKey, MOBILE_AUTH_COOKIE, SESSION_CODE_TTL_MS, signSessionCode } from "@/lib/session-code"

// Lands in Chrome right after Google OAuth completes. Chrome holds the fresh
// session cookie; the WebView that started the flow does not. This route seals
// the cookie into a signed, short-lived code stored under the flow's auth_key,
// which the WebView collects through /api/mobile-auth-poll + /api/mobile-set-cookie.
//
// Two things are required now that used to be optional:
//  · an auth_key — there is no keyless variant. The old fallback put the
//    signed session code straight into an intent:// URI on a plain custom
//    scheme, which any app registering that scheme could intercept.
//  · the auth_key must match the cookie mobile-auth-start set in THIS browser,
//    so a code can only ever be stored under a key this browser started.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const authKey = url.searchParams.get("auth_key") ?? ""
  if (!isAuthKey(authKey)) {
    return new Response("Missing or malformed auth_key", { status: 400 })
  }

  const cookieStore = await cookies()
  if (cookieStore.get(MOBILE_AUTH_COOKIE)?.value !== authKey) {
    return Response.redirect(new URL("/signin?error=MobileFlowMismatch", request.url))
  }

  const secureCookie = cookieStore.get("__Secure-authjs.session-token")
  const insecureCookie = cookieStore.get("authjs.session-token")
  const sessionCookie = secureCookie ?? insecureCookie
  if (!sessionCookie) {
    return Response.redirect(new URL("/signin?error=OAuthCallback", request.url))
  }

  const cookieName = secureCookie ? "__Secure-authjs.session-token" : "authjs.session-token"
  const expiresAt = Date.now() + SESSION_CODE_TTL_MS
  const code = signSessionCode({ t: sessionCookie.value, n: cookieName, x: expiresAt })

  // delete+create rather than upsert: repeated sign-in attempts under one key
  // must replace, and the composite key makes upsert awkward.
  await prisma.verificationToken.deleteMany({ where: { identifier: `mobile-auth:${authKey}` } })
  await prisma.verificationToken.create({
    data: { identifier: `mobile-auth:${authKey}`, token: code, expires: new Date(expiresAt) },
  })

  // Only the opaque key travels through the intent — never the code itself.
  const intentTarget = `intent://auth?key=${encodeURIComponent(authKey)}#Intent;scheme=emergenthealth;package=app.emergenthealth;end`
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
  </script>
</body>
</html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        // The binding cookie has done its job.
        "Set-Cookie": `${MOBILE_AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
      },
    }
  )
}
