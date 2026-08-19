import { NextRequest, NextResponse } from "next/server"
import { Resend } from "resend"
import { prisma } from "@/lib/prisma"
import { localDateStr, localTimeStr } from "@/lib/local-date"
import { readSentLog, writeSentLog } from "@/lib/sent-log"
import { buildExportBundle } from "@/lib/export"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// Monthly off-site backup: on the 1st, every user gets their full export
// mailed to them, so the account's history exists somewhere no bug,
// migration, or vendor outage can reach. Ticked every ten minutes by the
// Actions cron; window-gated to the morning of the 1st in each user's own
// timezone, once per month via the sent log.

const SENT_KEY = "daily_nudges_sent"
const SENT_ID = "monthly-export"

// Resend caps attachments around 40MB; leave generous headroom for the
// base64 inflation and the rest of the message.
const MAX_ATTACH_BYTES = 25 * 1024 * 1024

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ skipped: true, reason: "RESEND_API_KEY not set" })
  }
  const resend = new Resend(process.env.RESEND_API_KEY)

  const users = await prisma.user.findMany({
    where: { email: { not: null } },
    select: { id: true, name: true, email: true },
  }).catch(() => [] as { id: string; name: string | null; email: string | null }[])
  if (users.length === 0) return NextResponse.json({ ok: true, emailed: 0 })

  const tzRows = await prisma.userPreference.findMany({
    where: { userId: { in: users.map(u => u.id) }, key: "timezone" },
    select: { userId: true, value: true },
  }).catch(() => [] as { userId: string; value: string }[])
  const tzByUser = new Map(tzRows.map(r => [r.userId, r.value.trim() || "UTC"]))

  let emailed = 0
  let skippedSize = 0

  for (const user of users) {
    const timezone = tzByUser.get(user.id) ?? "UTC"
    const localDate = localDateStr(timezone)
    const localHour = parseInt(localTimeStr(timezone).slice(0, 2), 10)

    // Morning of the 1st, local time; the sent log absorbs the extra ticks.
    if (!localDate.endsWith("-01") || localHour < 8 || localHour > 11) continue

    const alreadySent = await readSentLog(user.id, SENT_KEY, localDate)
    if (alreadySent.has(SENT_ID)) continue

    // Record before sending: a failing export shouldn't retry (and re-dump
    // the whole database) on every tick for four hours.
    alreadySent.add(SENT_ID)
    await writeSentLog(user.id, SENT_KEY, localDate, alreadySent)

    let bundle
    try {
      bundle = await buildExportBundle(user.id)
    } catch {
      continue
    }
    if (bundle.rowCount === 0) continue
    if (bundle.bytes > MAX_ATTACH_BYTES) { skippedSize++; continue }

    const firstName = user.name?.split(" ")[0] ?? "there"
    const sizeMb = (bundle.bytes / 1024 / 1024).toFixed(1)
    try {
      await resend.emails.send({
        from: "Emergenthealth <onboarding@resend.dev>",
        to: user.email!,
        subject: `💾 Your monthly data backup — ${bundle.filename.replace("emergenthealth-export-", "").replace(".json", "")}`,
        html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;color:#0f0f1a">
          <h2 style="font-size:18px;margin:0 0 8px">💾 Monthly backup</h2>
          <p style="color:#555;font-size:14px;line-height:1.6">Hi ${firstName}, attached is your complete Emergenthealth export — ${bundle.tableCount} tables, ${bundle.rowCount.toLocaleString()} rows, ${sizeMb}MB. Keep it somewhere safe; with this file your history survives anything that happens to the app.</p>
          <p style="color:#999;font-size:11px;margin-top:20px">Sent on the 1st of every month. Credential tables (OAuth tokens, keys) are never included.</p>
        </div>`,
        attachments: [{ filename: bundle.filename, content: Buffer.from(bundle.json, "utf8").toString("base64") }],
      })
      emailed++
    } catch { /* non-fatal — the Settings download always works */ }
  }

  return NextResponse.json({ ok: true, emailed, skippedSize, users: users.length })
}
