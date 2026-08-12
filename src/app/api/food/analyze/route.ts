import { auth } from "@/auth"
import { NextResponse } from "next/server"
import { analyzeMealPhoto } from "@/lib/food-analyze"

// The compressed camera capture is ~50-150KB; anything past this is not one of ours.
const MAX_IMAGE_CHARS = 2_000_000

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

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
