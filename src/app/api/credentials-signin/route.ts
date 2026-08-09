import { prisma } from "@/lib/prisma"
import { randomUUID, timingSafeEqual } from "crypto"

// Username/password sign-in that issues a database session directly, without
// Google OAuth. Two things need it:
//
//  - the native Android WebView, where the OAuth callback lands in Chrome's
//    cookie jar rather than the WebView's;
//  - the Play Store reviewer, who cannot be handed a Google account.
//
// The credentials live in the environment. They were previously written into
// this file — in a public repository — which published a working login to the
// owner's account, health data, chat history and API keys included. Never put
// them back in the source.
//
// Two independent logins can be configured, each a username/password/email
// trio. Neither is required; an unset trio simply isn't accepted.
//
//   CREDENTIALS_USERNAME / CREDENTIALS_PASSWORD / CREDENTIALS_EMAIL
//     the owner's own login, for the Android WebView
//
//   DEMO_USERNAME / DEMO_PASSWORD / DEMO_EMAIL
//     the Play Store reviewer's login, pointed at the seeded demo account so
//     no real data is ever exposed to review

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  // Compare lengths separately; timingSafeEqual throws on a length mismatch.
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

interface Login { username: string; password: string; email: string }

function configuredLogins(): Login[] {
  const trios: [string | undefined, string | undefined, string | undefined][] = [
    [process.env.CREDENTIALS_USERNAME, process.env.CREDENTIALS_PASSWORD, process.env.CREDENTIALS_EMAIL],
    [process.env.DEMO_USERNAME, process.env.DEMO_PASSWORD, process.env.DEMO_EMAIL],
  ]
  return trios
    .filter((t): t is [string, string, string] => t.every(Boolean))
    .map(([username, password, email]) => ({ username, password, email }))
}

export async function POST(request: Request) {
  const logins = configuredLogins()

  // Unconfigured means disabled, not open.
  if (logins.length === 0) {
    return Response.json({ error: "Password sign-in is not enabled." }, { status: 404 })
  }

  let username: string, password: string
  try {
    const body = await request.json()
    username = String(body.username ?? "")
    password = String(body.password ?? "")
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 })
  }

  // Every configured login is checked with both fields compared, so the time
  // taken doesn't reveal which username exists.
  let matched: Login | null = null
  for (const login of logins) {
    const userOk = safeEqual(username, login.username)
    const passOk = safeEqual(password, login.password)
    if (userOk && passOk) matched = login
  }
  if (!matched) {
    return Response.json({ error: "Invalid username or password." }, { status: 401 })
  }

  const user = await prisma.user.findFirst({ where: { email: matched.email } })
  if (!user) {
    return Response.json({ error: "User not found. Sign in with Google first." }, { status: 404 })
  }

  const sessionToken = randomUUID()
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires },
  })

  // Use __Secure- prefix on HTTPS (Auth.js v5 production cookie name)
  const url = new URL(request.url)
  const secure = url.protocol === "https:"
  const cookieName = secure ? "__Secure-authjs.session-token" : "authjs.session-token"
  const cookieStr = [
    `${cookieName}=${sessionToken}`,
    "Path=/",
    secure ? "Secure" : "",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${30 * 24 * 60 * 60}`,
  ].filter(Boolean).join("; ")

  // Returns 200 + Set-Cookie + a JS redirect rather than a 302: Android WebView
  // drops Set-Cookie on 3xx responses for loadUrl()-style navigations.
  return new Response(
    `<!DOCTYPE html><html><body><script>window.location.replace('/dashboard')</script></body></html>`,
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
