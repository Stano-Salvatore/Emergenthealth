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
// Required environment variables (the route refuses every request unless all
// three are set):
//   CREDENTIALS_USERNAME   the username to accept
//   CREDENTIALS_PASSWORD   the password to accept
//   CREDENTIALS_EMAIL      the email of the User row to issue the session for

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  // Compare lengths separately; timingSafeEqual throws on a length mismatch.
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export async function POST(request: Request) {
  const expectedUser = process.env.CREDENTIALS_USERNAME
  const expectedPass = process.env.CREDENTIALS_PASSWORD
  const accountEmail = process.env.CREDENTIALS_EMAIL

  // Unconfigured means disabled, not open.
  if (!expectedUser || !expectedPass || !accountEmail) {
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

  // Both compared regardless of the first result, so a wrong username and a
  // wrong password cost the same time.
  const userOk = safeEqual(username, expectedUser)
  const passOk = safeEqual(password, expectedPass)
  if (!userOk || !passOk) {
    return Response.json({ error: "Invalid username or password." }, { status: 401 })
  }

  const user = await prisma.user.findFirst({ where: { email: accountEmail } })
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
