import { NextRequest, NextResponse } from "next/server"
import { Resend } from "resend"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { buildHealthReport } from "@/lib/health-report"
import { renderReportEmail, reportSubject } from "@/lib/health-report-email"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// Mail the health report to the account's own address.
//
// The printable page relies on the browser's print stack, and an Android
// WebView has none — window.print() there is a silent no-op, so on the phone
// the export button did nothing. Email works on every surface, arrives
// somewhere it can be kept, and can be forwarded or printed from a mail client
// that does have a print stack. It goes only to the address on the account:
// this is a health record, not something to hand an arbitrary recipient field.

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Email is not configured on this deployment." }, { status: 503 })
  }

  const rl = checkRateLimit(userId, "report_email", 10, 60 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many reports sent in the last hour.", resetAt: rl.resetAt }, { status: 429 })
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }).catch(() => null)
  if (!user?.email) {
    return NextResponse.json({ error: "Your account has no email address to send to." }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const days = [30, 90, 180].includes(Number(body?.days)) ? Number(body.days) : 90

  let report
  try {
    report = await buildHealthReport(userId, days)
  } catch {
    return NextResponse.json({ error: "Couldn't build the report." }, { status: 500 })
  }

  try {
    await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: "Emergenthealth <onboarding@resend.dev>",
      to: user.email,
      subject: reportSubject(report),
      html: renderReportEmail(report),
    })
  } catch {
    return NextResponse.json({ error: "The mail service rejected the message." }, { status: 502 })
  }

  return NextResponse.json({ ok: true, to: user.email })
}
