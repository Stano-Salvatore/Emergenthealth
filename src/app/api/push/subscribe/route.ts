import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// The PushSubscription table is declared in prisma/schema.prisma and created
// by the build's `prisma db push` — it used to be created lazily here, which
// meant every push cron errored on the table's absence until the first
// successful subscribe.

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const subscription = body.subscription ?? body
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 })
  }

  await prisma.$executeRaw`
    INSERT INTO "PushSubscription" ("userId", endpoint, p256dh, auth)
    VALUES (${session.user.id}, ${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth})
    ON CONFLICT (endpoint) DO UPDATE SET "userId" = EXCLUDED."userId", p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
  `

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))

  // Clearing every browser subscription on the account, not just the one the
  // caller holds. Inside the native app you hold none: the browser that
  // subscribed was Chrome, months ago, and nothing in the app can reach it.
  // sendToUser delivers to every channel, so that stale subscription is why
  // Emergy arrives twice — and until now there was no way to end it from the
  // device actually being bothered.
  if (body?.all === true) {
    await prisma.$executeRaw`
      DELETE FROM "PushSubscription" WHERE "userId" = ${session.user.id}
    `.catch(() => {})
    return NextResponse.json({ ok: true, cleared: "all" })
  }

  const endpoint = body?.endpoint
  if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 })

  await prisma.$executeRaw`
    DELETE FROM "PushSubscription" WHERE endpoint = ${endpoint} AND "userId" = ${session.user.id}
  `.catch(() => {})

  return NextResponse.json({ ok: true })
}
