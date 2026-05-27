import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Resend } from "resend"

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "NewsletterSubscriber" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      "email" TEXT NOT NULL UNIQUE,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now()
    )
  `.catch(() => {})
}

export async function POST(req: NextRequest) {
  const { email } = await req.json().catch(() => ({ email: "" }))
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 })
  }

  await ensureTable()

  const inserted = await prisma.$executeRaw`
    INSERT INTO "NewsletterSubscriber" ("email")
    VALUES (${email.toLowerCase().trim()})
    ON CONFLICT ("email") DO NOTHING
  `.catch(() => BigInt(0))

  if (inserted === BigInt(0)) {
    // Already subscribed — still return success to avoid enumeration
    return NextResponse.json({ ok: true })
  }

  // Send welcome email
  if (resend) {
    await resend.emails.send({
      from: "Emergenthealth <hello@emergenthealth.app>",
      to: email.trim(),
      subject: "You're on the list! 🎉",
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:40px 24px;background:#09090f;color:#f2f2fa;">
          <p style="font-size:28px;margin:0 0 16px">🌿</p>
          <h1 style="font-size:22px;font-weight:700;margin:0 0 12px;color:#f2f2fa">Thanks for signing up!</h1>
          <p style="color:#7a7a96;font-size:15px;line-height:1.6;margin:0 0 24px">
            You're on the Emergenthealth list. We'll keep you posted on new features and integrations as they launch.
          </p>
          <a href="https://emergenthealth.vercel.app" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;">
            Go to the app →
          </a>
          <p style="color:#4a4a60;font-size:12px;margin:32px 0 0">
            You can unsubscribe at any time by replying to this email.
          </p>
        </div>
      `,
    }).catch(() => {})

    // Also notify owner
    if (process.env.FEEDBACK_NOTIFY_EMAIL) {
      await resend.emails.send({
        from: "Emergenthealth <noreply@emergenthealth.app>",
        to: process.env.FEEDBACK_NOTIFY_EMAIL,
        subject: `New newsletter signup: ${email}`,
        html: `<p>${email} just signed up for updates.</p>`,
      }).catch(() => {})
    }
  }

  return NextResponse.json({ ok: true })
}
