import { Auth, skipCSRFCheck } from "@auth/core"
import { authConfig } from "@/auth"

// Called by Chrome Custom Tab (via /mobile-signin redirect) to initiate Google
// OAuth. Unlike the Server Action approach in /mobile-signin, this is a plain
// HTTP Route Handler — Auth() returns a real Response whose Set-Cookie headers
// Chrome actually stores. The Server Action + redirect() path goes through
// Next.js's RSC transport, which does not reliably deliver Set-Cookie to
// Chrome, so authjs.callback-url was never reaching Chrome's cookie jar.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const authKey = url.searchParams.get("auth_key") ?? ""

  const callbackUrl = authKey
    ? `/api/mobile-auth-bridge?auth_key=${encodeURIComponent(authKey)}`
    : "/api/mobile-auth-bridge"

  // POST to /api/auth/signin/google with callbackUrl — same internal call that
  // next-auth's signIn() helper makes, but from a Route Handler so the response
  // is a real HTTP 302 + Set-Cookie that Chrome processes natively.
  const signinUrl = new URL("/api/auth/signin/google", url.origin)
  const signinReq = new Request(signinUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ callbackUrl }),
  })

  // authConfig has already been mutated by NextAuth(authConfig) at module load
  // time (secret, basePath, providers resolved). skipCSRFCheck bypasses the
  // double-submit CSRF check so we don't need a csrfToken in the body.
  return Auth(signinReq, { ...authConfig, skipCSRFCheck })
}
