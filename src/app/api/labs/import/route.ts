import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { analyzeLabDocument, LAB_IMPORT_DISCLAIMER } from "@/lib/lab-analyze"
import { checkRateLimit } from "@/lib/rate-limit"
import { claimDailyUse, DAILY_CAPS } from "@/lib/daily-cap"
import { LAB_IMPORT_MAX_CHARS, LAB_IMPORT_TOO_LARGE } from "@/lib/lab-import-limit"

export const runtime = "nodejs"
// Opus at high effort over a multi-page report; a kill mid-generation is
// billed and never recorded.
export const maxDuration = 300

// Reads the document and hands the rows back. It deliberately writes nothing:
// a transcription the user hasn't checked has no business in a health record,
// so saving is a second, explicit step through /api/labs.

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // A multi-page lab document is the single most expensive call in the app.
  const rl = checkRateLimit(session.user.id, "labs_import", 20, 60 * 60 * 1000)
  if (!rl.allowed) return NextResponse.json({ error: "Too many imports this hour — try again later.", resetAt: rl.resetAt }, { status: 429 })

  const { document } = await req.json().catch(() => ({})) as { document?: unknown }
  if (typeof document !== "string" || !document.startsWith("data:")) {
    return NextResponse.json({ error: "document (data URL) required" }, { status: 400 })
  }
  if (document.length > LAB_IMPORT_MAX_CHARS) {
    return NextResponse.json({ error: LAB_IMPORT_TOO_LARGE }, { status: 413 })
  }

  const userId = session.user.id
  if (!(await claimDailyUse(userId, DAILY_CAPS.labImport.key, DAILY_CAPS.labImport.limit)).allowed) {
    return NextResponse.json({ error: "That's today's limit for reading lab reports — it resets at midnight." }, { status: 429 })
  }

  try {
    const parsed = await analyzeLabDocument(document, session.user.id)
    if (!parsed) {
      return NextResponse.json({ error: "Couldn't read that file. A PNG, JPEG or PDF of the report works best." }, { status: 422 })
    }
    if (!parsed.isLabReport) {
      return NextResponse.json({ error: "That doesn't look like a lab report.", ...parsed }, { status: 422 })
    }
    return NextResponse.json({ ...parsed, disclaimer: LAB_IMPORT_DISCLAIMER })
  } catch (e) {
    console.error("[labs/import] error:", e)
    return NextResponse.json({ error: "Failed to read the document" }, { status: 500 })
  }
}
