import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { signState } from "@/lib/state-token"
import { TL_AUTH } from "@/lib/truelayer-sync"

function appOrigin(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || new URL(req.url).origin
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.redirect(new URL("/signin", req.url))

  const callbackUrl = new URL("/api/truelayer/callback", appOrigin(req)).toString()

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.TRUELAYER_CLIENT_ID!,
    redirect_uri: callbackUrl,
    scope: "accounts transactions offline_access",
    state: signState(session.user.id),
    providers: "uk-ob-all uk-oauth-all eu-ob-all eu-oauth-all",
  })

  return NextResponse.redirect(`${TL_AUTH}/?${params.toString()}`)
}
