import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { configurePush, loadSubscriptionsByUser, sendToUser } from "@/lib/push"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  if (!configurePush()) {
    return NextResponse.json({ error: "Push notifications not configured. Add VAPID keys to environment variables." }, { status: 503 })
  }

  const subs = (await loadSubscriptionsByUser([userId])).get(userId) ?? []
  if (subs.length === 0) {
    return NextResponse.json({ error: "No subscriptions found" }, { status: 404 })
  }

  const delivered = await sendToUser(subs, {
    title: "Emergenthealth",
    body: "Push notifications are working! ✅",
    url: "/dashboard",
    tag: "test",
  })

  // "Sent!" while every device rejected the push is exactly the silent
  // failure this endpoint exists to rule out — say so instead. sendToUser has
  // already dropped any 410-gone subscriptions, so re-enabling starts clean.
  if (!delivered) {
    return NextResponse.json(
      { error: "Every registered device rejected the push — try disabling and re-enabling notifications." },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true })
}
