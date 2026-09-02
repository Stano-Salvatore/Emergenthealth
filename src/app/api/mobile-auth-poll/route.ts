import { prisma } from "@/lib/prisma"
import { isAuthKey } from "@/lib/session-code"

// Polled by the native WebView while Chrome handles Google OAuth.
// Returns {done:true} once the bridge has stored the signed session code
// in VerificationToken, signalling the WebView to redeem it via /api/mobile-set-cookie.
export async function GET(request: Request) {
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
