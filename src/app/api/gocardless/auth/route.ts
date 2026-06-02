import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { signState } from "@/lib/state-token"
import { GC_API, REVOLUT_INSTITUTION_ID, getAccessToken, gcHeaders, ensureGCTable } from "@/lib/gocardless-sync"

function appOrigin(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || new URL(req.url).origin
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.redirect(new URL("/signin", req.url))

  const origin = appOrigin(req)
  const state = signState(session.user.id)
  const redirectUri = new URL(`/api/gocardless/callback?state=${encodeURIComponent(state)}`, origin).toString()

  try {
    await ensureGCTable()
    const token = await getAccessToken()

    const res = await fetch(`${GC_API}/requisitions/`, {
      method: "POST",
      headers: gcHeaders(token),
      body: JSON.stringify({
        redirect: redirectUri,
        institution_id: REVOLUT_INSTITUTION_ID,
        reference: session.user.id.slice(0, 64),
        user_language: "EN",
      }),
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error("[gocardless/auth] requisition error:", res.status, errBody)
      return NextResponse.redirect(new URL("/dashboard/settings?gc_error=requisition_error", req.url))
    }

    const data = await res.json()
    return NextResponse.redirect(data.link as string)
  } catch (err: unknown) {
    console.error("[gocardless/auth] error:", err)
    return NextResponse.redirect(new URL("/dashboard/settings?gc_error=auth_error", req.url))
  }
}
