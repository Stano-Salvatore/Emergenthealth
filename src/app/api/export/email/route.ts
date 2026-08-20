import { NextResponse } from "next/server"
import { Resend } from "resend"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { buildExportBundle } from "@/lib/export"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// Mail the full backup to the account's own address, on demand.
//
// The Export menu hands the browser a Content-Disposition attachment, which is
// the right thing to do and works everywhere except the one place this app is
// mostly used: an Android WebView with no DownloadListener does nothing at all
// with a download — no file, no error, no warning. The native shell now
// installs one, but that only reaches phones on a new build, and a backup you
// cannot take is not a backup. Email needs nothing from the client.
//
// Same size ceiling as the monthly backup cron, for the same reason.
const MAX_ATTACH_BYTES = 25 * 1024 * 1024

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Email is not configured on this deployment." }, { status: 503 })
  }

  // Dumping every table is expensive; a handful a day is plenty for a backup.
  const rl = checkRateLimit(userId, "export_email", 5, 24 * 60 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "You've emailed yourself a backup a few times today already.", resetAt: rl.resetAt },
      { status: 429 }
    )
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  }).catch(() => null)
  if (!user?.email) {
    return NextResponse.json({ error: "Your account has no email address to send to." }, { status: 400 })
  }

  let bundle
  try {
    bundle = await buildExportBundle(userId)
  } catch {
    return NextResponse.json({ error: "Couldn't build the backup." }, { status: 500 })
  }
  if (bundle.rowCount === 0) {
    return NextResponse.json({ error: "There's nothing to back up yet." }, { status: 400 })
  }
  if (bundle.bytes > MAX_ATTACH_BYTES) {
    return NextResponse.json({
      error: `Your export is ${(bundle.bytes / 1024 / 1024).toFixed(0)}MB — past what email will carry. Download it instead.`,
    }, { status: 413 })
  }

  const firstName = user.name?.split(" ")[0] ?? "there"
  const sizeMb = (bundle.bytes / 1024 / 1024).toFixed(1)

  try {
    await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: "Emergenthealth <onboarding@resend.dev>",
      to: user.email,
      subject: `💾 Your Emergenthealth backup — ${bundle.filename.replace("emergenthealth-export-", "").replace(".json", "")}`,
      html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;color:#0f0f1a">
        <h2 style="font-size:18px;margin:0 0 8px">💾 Your backup</h2>
        <p style="color:#555;font-size:14px;line-height:1.6">Hi ${firstName}, attached is your complete Emergenthealth export — ${bundle.tableCount} tables, ${bundle.rowCount.toLocaleString()} rows, ${sizeMb}MB. Keep it somewhere safe; with this file your history survives anything that happens to the app.</p>
        <p style="color:#999;font-size:11px;margin-top:20px">You asked for this from Settings. One also goes out on the 1st of every month. Credential tables (OAuth tokens, keys) are never included.</p>
      </div>`,
      attachments: [{ filename: bundle.filename, content: Buffer.from(bundle.json, "utf8").toString("base64") }],
    })
  } catch {
    return NextResponse.json({ error: "The mail service rejected the message." }, { status: 502 })
  }

  return NextResponse.json({ ok: true, to: user.email, rows: bundle.rowCount, tables: bundle.tableCount })
}
