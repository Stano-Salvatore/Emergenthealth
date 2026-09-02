import { auth } from "@/auth"
import { NextResponse } from "next/server"
import { analyzeMealPhoto } from "@/lib/food-analyze"
import { checkRateLimit } from "@/lib/rate-limit"

// The compressed camera capture is ~50-150KB; anything past this is not one of ours.
const MAX_IMAGE_CHARS = 2_000_000

export const maxDuration = 60

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Every call is a vision model call; a runaway client shouldn't be able to
  // spend without a ceiling. Sixty photos an hour is more than any meal needs.
  const rl = checkRateLimit(session.user.id, "food_analyze", 60, 60 * 60 * 1000)
  if (!rl.allowed) return NextResponse.json({ error: "Too many photos this hour — try again later.", resetAt: rl.resetAt }, { status: 429 })

  const { image, hint, label, previous } = await req.json().catch(() => ({}))
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    return NextResponse.json({ error: "image (data URL) required" }, { status: 400 })
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return NextResponse.json({ error: "image too large" }, { status: 413 })
  }
  const labelOk = typeof label === "string" && label.startsWith("data:image/") && label.length <= MAX_IMAGE_CHARS

  try {
    const analysis = await analyzeMealPhoto(image, {
      hint: typeof hint === "string" ? hint : undefined,
      labelImageDataUrl: labelOk ? label : undefined,
      previous: previous && typeof previous === "object" ? previous : undefined,
    })
    if (!analysis) return NextResponse.json({ error: "could not analyze the photo" }, { status: 422 })
    return NextResponse.json(analysis)
  } catch (e) {
    console.error("food analyze failed", e)
    return NextResponse.json({ error: "analysis failed, try again" }, { status: 502 })
  }
}
