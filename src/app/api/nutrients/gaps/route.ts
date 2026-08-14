import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { loadNutrientReport } from "@/lib/nutrient-gaps-load"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const report = await loadNutrientReport(session.user.id)
  return NextResponse.json(report)
}
