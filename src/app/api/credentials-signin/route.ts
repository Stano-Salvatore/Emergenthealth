import { prisma } from "@/lib/prisma"
import { randomUUID } from "crypto"

// Personal single-user credentials login for the native Android WebView.
// Bypasses Google OAuth entirely so the session cookie is set directly in
// the WebView's jar — no Chrome Custom Tab or cross-jar handoff needed.
//
// Returns 200 + Set-Cookie + JS redirect on success (not 302) because
// Android WebView drops Set-Cookie on 3xx responses for loadUrl()-style
// navigations; form submissions are fine with either, but 200 is safer.
export async function POST(request: Request) {
  let username: string, password: string
  try {
    const body = await request.json()
    username = body.username ?? ""
    password = body.password ?? ""
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 })
  }

  if (username !== "Salvatore" || password !== "Nexia29") {
    return Response.json({ error: "Invalid username or password." }, { status: 401 })
  }

  const user = await prisma.user.findFirst({
    where: { email: "stanislavnandory@gmail.com" },
  })
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
