import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { signState } from "@/lib/state-token"

function appOrigin(req: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.AUTH_URL ??
    new URL(req.url).origin
  )
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/signin", req.url))
  }

  const callbackUrl = new URL("/api/ynab/callback", appOrigin(req)).toString()

  const params = new URLSearchParams({
    client_id: process.env.YNAB_CLIENT_ID!,
    redirect_uri: callbackUrl,
    response_type: "code",
    state: signState(session.user.id),
  })

  return NextResponse.redirect(
    `https://app.youneedabudget.com/oauth/authorize?${params.toString()}`
  )
}
