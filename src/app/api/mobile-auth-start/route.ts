import { Auth, skipCSRFCheck } from "@auth/core"
import { authConfig } from "@/auth"
import { prisma } from "@/lib/prisma"
import { checkRateLimit, clientIp } from "@/lib/rate-limit"
import { isAuthKey, MOBILE_AUTH_COOKIE } from "@/lib/session-code"

// Called by Chrome Custom Tab (via /mobile-signin redirect) to initiate Google
// OAuth. Stores a pending marker in VerificationToken so auth.ts redirect
// callback can force Chrome to /api/mobile-auth-bridge even if the callbackUrl
// cookie mechanism fails (which it does when skipCSRFCheck is active in
// Auth.js v5 beta).
//
// The marker is bound to this browser: the same response sets a cookie
// carrying the key, and the redirect callback only honours a marker whose key
// matches that cookie. A marker planted from somewhere else is inert.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const raw = url.searchParams.get("auth_key") ?? ""

  // Public, unauthenticated, and it writes rows — so it is limited per
  // address, and it only ever accepts the UUID shape the native app mints.
  const { allowed } = checkRateLimit(clientIp(request), "mobile_auth_start", 10, 10 * 60 * 1000)
  if (!allowed) return new Response("Too many sign-in attempts. Try again in a few minutes.", { status: 429 })
  if (raw && !isAuthKey(raw)) return new Response("Bad auth_key", { status: 400 })
  const authKey = raw

  if (authKey) {
    // Store a pending marker so the redirect callback in auth.ts can intercept
    // the post-sign-in redirect and force Chrome to the bridge route.
    await prisma.verificationToken.deleteMany({
      where: { identifier: `mobile-auth-pending:${authKey}` },
    })
    await prisma.verificationToken.create({
      data: {
        identifier: `mobile-auth-pending:${authKey}`,
        token: "pending",
        expires: new Date(Date.now() + 600_000), // 10 minutes
      },
    })
  }

  const callbackUrl = authKey
    ? `/api/mobile-auth-bridge?auth_key=${encodeURIComponent(authKey)}`
    : "/api/mobile-auth-bridge"

  const signinUrl = new URL("/api/auth/signin/google", url.origin)
  const signinReq = new Request(signinUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ callbackUrl }),
  })

  // next-auth bundles its own copy of @auth/core (0.41.0) while the Prisma
  // adapter pulls 0.41.1 to the top level. The two copies are structurally
  // identical but nominally distinct types, so handing our config to the
  // top-level Auth() doesn't typecheck even though the runtime objects match.
  // This cast is the seam between the duplicate copies — deduplicating the
  // dependency would remove the need for it.
  const config = { ...authConfig, skipCSRFCheck } as unknown as Parameters<typeof Auth>[1]
  const res = await Auth(signinReq, config)
  if (!authKey) return res

  // Bind the marker to this browser. HttpOnly + Lax: only this origin's own
  // navigations carry it back, which is exactly the OAuth callback.
  const secure = url.protocol === "https:"
  const headers = new Headers(res.headers)
  headers.append(
    "Set-Cookie",
    `${MOBILE_AUTH_COOKIE}=${authKey}; Path=/; ${secure ? "Secure; " : ""}HttpOnly; SameSite=Lax; Max-Age=600`,
  )
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}
