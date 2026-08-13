import { Auth, skipCSRFCheck } from "@auth/core"
import { authConfig } from "@/auth"
import { prisma } from "@/lib/prisma"

// Called by Chrome Custom Tab (via /mobile-signin redirect) to initiate Google
// OAuth. Stores a pending marker in VerificationToken so auth.ts redirect callback
// can force Chrome to /api/mobile-auth-bridge even if the callbackUrl cookie
// mechanism fails (which it does when skipCSRFCheck is active in Auth.js v5 beta).
export async function GET(request: Request) {
  const url = new URL(request.url)
  const authKey = url.searchParams.get("auth_key") ?? ""

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
  return Auth(signinReq, config)
}
