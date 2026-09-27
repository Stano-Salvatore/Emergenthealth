import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server"
import { checkRateLimit } from "@/lib/rate-limit"

const RP_ID = process.env.NEXT_PUBLIC_APP_URL?.replace(/^https?:\/\//, "").split(":")[0] ?? "localhost"
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
const CHALLENGE_TTL_MS = 5 * 60_000

// GET: generate challenge for a passkey login attempt
export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown"
  const { allowed } = checkRateLimit(ip, "passkey-challenge", 20, 60_000)
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
    allowCredentials: [],
  })

  // Nobody is signed in yet, so the challenge cannot live in a per-user table:
  // UserPreference's foreign key to User refused every insert.
  const tempToken = crypto.randomUUID()
  // A cancelled prompt never comes back to consume its challenge; stale ones
  // are cleared here so they don't pile up. Housekeeping only, so it never
  // stands in the way of the sign-in being asked for.
  await prisma.verificationToken.deleteMany({
    where: { identifier: { startsWith: "passkey-auth:" }, expires: { lt: new Date() } },
  }).catch(e => console.error("[passkey/authenticate] expired challenge sweep failed:", e))
  await prisma.verificationToken.create({
    data: {
      identifier: `passkey-auth:${tempToken}`,
      token: options.challenge,
      expires: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  })

  return NextResponse.json({ ...options, tempToken })
}

// POST: verify and sign in
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown"
  const { allowed } = checkRateLimit(ip, "passkey-verify", 10, 60_000)
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  const { response, tempToken } = await req.json().catch(() => ({}))
  if (typeof tempToken !== "string" || typeof response?.id !== "string") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 })
  }

  const identifier = `passkey-auth:${tempToken}`
  const challengeRecord = await prisma.verificationToken.findFirst({
    where: { identifier, expires: { gt: new Date() } },
  })
  if (!challengeRecord) return NextResponse.json({ error: "Challenge expired" }, { status: 400 })

  // Single use: of two concurrent answers to one challenge, only the one that
  // removes the row goes on to verify.
  const { count } = await prisma.verificationToken.deleteMany({ where: { identifier } })
  if (count === 0) return NextResponse.json({ error: "Challenge expired" }, { status: 400 })

  const passkey = await prisma.passkey.findUnique({
    where: { credentialId: response.id },
    include: { user: true },
  })
  if (!passkey) return NextResponse.json({ error: "Passkey not found" }, { status: 400 })

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeRecord.token,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter),
        transports: passkey.transports as AuthenticatorTransport[],
      },
    })

    if (!verification.verified) return NextResponse.json({ error: "Verification failed" }, { status: 400 })

    // Update counter
    await prisma.passkey.update({
      where: { credentialId: passkey.credentialId },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    })

    // Create a NextAuth session
    const dbSession = await prisma.session.create({
      data: {
        sessionToken: crypto.randomUUID(),
        userId: passkey.userId,
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    // Auth.js reads the __Secure- name on HTTPS; under the bare name the new
    // session is invisible and /dashboard bounces back to /signin.
    const secure = new URL(req.url).protocol === "https:"
    const res = NextResponse.json({ ok: true, redirectTo: "/dashboard" })
    res.cookies.set(secure ? "__Secure-authjs.session-token" : "authjs.session-token", dbSession.sessionToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      expires: dbSession.expires,
    })
    return res
  } catch (err) {
    console.error("[passkey/authenticate] verification failed:", err)
    return NextResponse.json({ error: "Verification failed" }, { status: 400 })
  }
}
