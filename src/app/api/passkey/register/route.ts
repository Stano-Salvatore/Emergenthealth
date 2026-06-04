import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server"

const RP_ID = process.env.NEXT_PUBLIC_APP_URL?.replace(/^https?:\/\//, "").split(":")[0] ?? "localhost"
const RP_NAME = "Emergenthealth"
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const existingPasskeys = await prisma.passkey.findMany({
    where: { userId: session.user.id },
    select: { credentialId: true, transports: true },
  })

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: new TextEncoder().encode(session.user.id),
    userName: session.user.email ?? session.user.id,
    userDisplayName: session.user.name ?? session.user.email ?? "User",
    attestationType: "none",
    excludeCredentials: existingPasskeys.map(pk => ({
      id: pk.credentialId,
      transports: pk.transports as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  })

  // Store challenge in session-scoped storage (using a short-lived DB record)
  await prisma.userPreference.upsert({
    where: { userId_key: { userId: session.user.id, key: "passkey_challenge" } },
    create: { userId: session.user.id, key: "passkey_challenge", value: options.challenge },
    update: { value: options.challenge },
  })

  return NextResponse.json(options)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = session.user.id
  const body = await req.json()
  const { response, name } = body

  const challengeRecord = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: "passkey_challenge" } },
  })
  if (!challengeRecord) return NextResponse.json({ error: "Challenge not found" }, { status: 400 })

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challengeRecord.value,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    })

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: "Verification failed" }, { status: 400 })
    }

    const { credential } = verification.registrationInfo

    await prisma.passkey.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        deviceType: verification.registrationInfo.credentialDeviceType,
        backedUp: verification.registrationInfo.credentialBackedUp,
        transports: response.response.transports ?? [],
        name: name ?? "Passkey",
      },
    })

    await prisma.userPreference.delete({
      where: { userId_key: { userId, key: "passkey_challenge" } },
    }).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}
