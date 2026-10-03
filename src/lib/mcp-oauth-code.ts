import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { prisma } from "@/lib/prisma"

// The one-time authorization code of the MCP OAuth flow.
//
// The code used to be the user's permanent MCP key, carried in a redirect URL
// where browser history, logs and Referer headers keep it. Now it is a random
// string worth nothing on its own: it names a stored grant that lasts ten
// minutes, is spent on first use, and is bound to the redirect it was issued
// for and to the client's PKCE challenge. Only the token endpoint turns it
// into the key, and only for whoever holds the verifier.

const TTL_MS = 10 * 60 * 1000
const PREFIX = "mcp-code:"

interface Grant {
  keyId: string
  redirectUri: string
  challenge: string
  method: "S256" | "plain" | ""
}

export function pkceMethod(m: string | null | undefined): Grant["method"] | null {
  if (!m) return ""
  return m === "S256" || m === "plain" ? m : null
}

export async function issueMcpCode(grant: Grant): Promise<string> {
  const code = randomBytes(32).toString("base64url")
  await prisma.verificationToken.create({
    data: { identifier: `${PREFIX}${code}`, token: JSON.stringify(grant), expires: new Date(Date.now() + TTL_MS) },
  })
  return code
}

function same(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export function pkceMatches(challenge: string, method: Grant["method"], verifier: string | null): boolean {
  if (!challenge) return true
  if (!verifier) return false
  // RFC 7636 §4.3: a challenge sent without a method is "plain".
  const derived = method === "S256" ? createHash("sha256").update(verifier).digest("base64url") : verifier
  return same(derived, challenge)
}

/**
 * The MCP key id a code was issued for, or null. The code is spent before it
 * is checked, so a wrong verifier burns it too — a guessed or intercepted code
 * gets one try, not many. The delete's count is what decides who spent it, so
 * two exchanges racing for one code can't both win.
 */
export async function redeemMcpCode(
  code: string,
  opts: { verifier: string | null; redirectUri: string | null },
): Promise<string | null> {
  const identifier = `${PREFIX}${code}`
  const row = await prisma.verificationToken.findFirst({ where: { identifier, expires: { gt: new Date() } } })
  if (!row) return null
  const { count } = await prisma.verificationToken.deleteMany({ where: { identifier } })
  if (count !== 1) return null

  let grant: Grant
  try { grant = JSON.parse(row.token) as Grant } catch { return null }
  if (opts.redirectUri && opts.redirectUri !== grant.redirectUri) return null
  if (!pkceMatches(grant.challenge, grant.method, opts.verifier)) return null
  return grant.keyId
}
