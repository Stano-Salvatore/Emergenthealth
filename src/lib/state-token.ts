import { createHmac, timingSafeEqual } from "crypto"

// Signs a userId into a tamper-proof state token for OAuth callbacks.
// Format: base64url(JSON({u,t})).HMAC-SHA256(payload)
export function signState(userId: string): string {
  const payloadB64 = Buffer.from(JSON.stringify({ u: userId, t: Date.now() })).toString("base64url")
  const sig = createHmac("sha256", process.env.AUTH_SECRET!).update(payloadB64).digest("base64url")
  return `${payloadB64}.${sig}`
}

// Returns the userId if the state is valid and fresh (< 15 min), else null.
export function verifyState(state: string | null): string | null {
  if (!state) return null
  try {
    const dot = state.lastIndexOf(".")
    if (dot === -1) return null
    const payloadB64 = state.slice(0, dot)
    const sig = state.slice(dot + 1)

    const expectedSig = createHmac("sha256", process.env.AUTH_SECRET!).update(payloadB64).digest("base64url")

    // Use timingSafeEqual to prevent timing attacks
    const sigBuf = Buffer.from(sig, "base64url")
    const expectedBuf = Buffer.from(expectedSig, "base64url")
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null

    const { u: userId, t: ts } = JSON.parse(Buffer.from(payloadB64, "base64url").toString())
    if (Date.now() - ts > 15 * 60 * 1000) return null // expired

    return typeof userId === "string" ? userId : null
  } catch {
    return null
  }
}
