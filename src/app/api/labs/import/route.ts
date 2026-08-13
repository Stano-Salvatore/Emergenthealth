import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { analyzeLabDocument, LAB_IMPORT_DISCLAIMER } from "@/lib/lab-analyze"

export const runtime = "nodejs"
export const maxDuration = 60

// Reads the document and hands the rows back. It deliberately writes nothing:
// a transcription the user hasn't checked has no business in a health record,
// so saving is a second, explicit step through /api/labs.

/** ~7 MB of base64. Enough for a phone photo or a multi-page PDF. */
const MAX_CHARS = 9_500_000

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { document } = await req.json().catch(() => ({})) as { document?: unknown }
  if (typeof document !== "string" || !document.startsWith("data:")) {
    return NextResponse.json({ error: "document (data URL) required" }, { status: 400 })
  }
  if (document.length > MAX_CHARS) {
    return NextResponse.json({ error: "That file is too large — try a photo of each page instead." }, { status: 413 })
  }

  try {
    const parsed = await analyzeLabDocument(document)
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
