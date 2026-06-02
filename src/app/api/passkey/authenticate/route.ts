import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server"
import { encode } from "next-auth/jwt"

const RP_ID = process.env.NEXT_PUBLIC_APP_URL?.replace(/^https?:\/\//, "").split(":")[0] ?? "localhost"
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

// GET: generate challenge for a passkey login attempt
export async function GET() {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
    allowCredentials: [],
  })

  // Store challenge keyed by a temp token
  const tempToken = crypto.randomUUID()
  await prisma.userPreference.create({
    data: {
      userId: `passkey_auth_${tempToken}`,
      key: "challenge",
      value: options.challenge,
    },
  }).catch(() => {})

  return NextResponse.json({ ...options, tempToken })
}

// POST: verify and sign in
export async function POST(req: NextRequest) {
  const { response, tempToken } = await req.json()

  const challengeRecord = await prisma.userPreference.findUnique({
    where: { userId_key: { userId: `passkey_auth_${tempToken}`, key: "challenge" } },
  })
  if (!challengeRecord) return NextResponse.json({ error: "Challenge expired" }, { status: 400 })

  await prisma.userPreference.delete({
    where: { userId_key: { userId: `passkey_auth_${tempToken}`, key: "challenge" } },
  }).catch(() => {})

  const passkey = await prisma.passkey.findUnique({
    where: { credentialId: response.id },
    include: { user: true },
  })
  if (!passkey) return NextResponse.json({ error: "Passkey not found" }, { status: 400 })

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeRecord.value,
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

    const res = NextResponse.json({ ok: true, redirectTo: "/dashboard" })
    res.cookies.set("authjs.session-token", dbSession.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: dbSession.expires,
    })
    return res
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}
