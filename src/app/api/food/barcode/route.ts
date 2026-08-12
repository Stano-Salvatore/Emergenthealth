import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"

// Barcode → exact nutrition via Open Food Facts (~3M products, label data,
// ODbL). For packaged food this beats any photo estimate: it IS the label.
// Server-side fetch keeps the client simple and adds a cache layer.

interface OffNutriments {
  "energy-kcal_100g"?: number
  energy_100g?: number // kJ fallback
  proteins_100g?: number
  carbohydrates_100g?: number
  fat_100g?: number
  sugars_100g?: number
}

interface OffProduct {
  product_name?: string
  brands?: string
  quantity?: string
  serving_quantity?: number | string
  nutriments?: OffNutriments
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const code = new URL(req.url).searchParams.get("code")?.trim() ?? ""
  if (!/^\d{6,14}$/.test(code)) {
    return NextResponse.json({ error: "Invalid barcode" }, { status: 400 })
  }

  const res = await fetch(
    `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,quantity,serving_quantity,nutriments`,
    {
      headers: { "User-Agent": "Emergenthealth/3.0 (personal health tracker)" },
      next: { revalidate: 86400 }, // product labels don't change often
    },
  ).catch(() => null)

  if (!res?.ok) {
    return NextResponse.json({ error: "Lookup failed" }, { status: 502 })
  }

  const body = await res.json().catch(() => null) as { status?: number; product?: OffProduct } | null
  if (!body || body.status !== 1 || !body.product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 })
  }

  const p = body.product
  const n = p.nutriments ?? {}
  const kcal100 = n["energy-kcal_100g"] ?? (n.energy_100g != null ? n.energy_100g / 4.184 : null)
  if (kcal100 == null) {
    return NextResponse.json({ error: "Product has no nutrition data" }, { status: 404 })
  }

  const servingG = typeof p.serving_quantity === "string" ? parseFloat(p.serving_quantity) : p.serving_quantity

  return NextResponse.json({
    code,
    name: [p.brands?.split(",")[0]?.trim(), p.product_name?.trim()].filter(Boolean).join(" ") || `Product ${code}`,
    quantity: p.quantity ?? null,             // e.g. "250 g" — the whole package
    servingG: Number.isFinite(servingG) && servingG! > 0 ? Math.round(servingG!) : null,
    per100: {
      kcal: Math.round(kcal100),
      proteinG: n.proteins_100g ?? null,
      carbsG: n.carbohydrates_100g ?? null,
      fatG: n.fat_100g ?? null,
      sugarG: n.sugars_100g ?? null,
    },
    source: "Open Food Facts",
  })
}
