import { prisma } from "@/lib/prisma"
import { checkRateLimit, clientIp } from "@/lib/rate-limit"
import { isAuthKey } from "@/lib/session-code"

// Polled by the native WebView while Chrome handles Google OAuth.
// Returns {done:true} once the bridge has stored the signed session code
// in VerificationToken, signalling the WebView to redeem it via /api/mobile-set-cookie.
export async function GET(request: Request) {
  // The wait page polls every 2s for at most five minutes; this leaves room
  // for that and a retry, not for sweeping keys.
  const { allowed } = checkRateLimit(clientIp(request), "mobile_auth_poll", 300, 10 * 60 * 1000)
  if (!allowed) return Response.json({ done: false }, { status: 429 })

  const key = new URL(request.url).searchParams.get("key")
  if (!isAuthKey(key)) return Response.json({ done: false })

  const record = await prisma.verificationToken.findFirst({
    where: {
      identifier: `mobile-auth:${key}`,
      expires: { gt: new Date() },
    },
    select: { identifier: true },
  })

  return Response.json({ done: !!record }, { headers: { "Cache-Control": "no-store" } })
}
