import { NextResponse } from "next/server"

// Serves /.well-known/assetlinks.json for Google Play TWA verification.
// After generating your signing key in PWABuilder, set ASSETLINKS_JSON in Vercel
// environment variables with the full JSON array from PWABuilder.
export async function GET() {
  const raw = process.env.ASSETLINKS_JSON
  if (!raw) {
    return NextResponse.json([], { status: 200 })
  }
  try {
    const parsed = JSON.parse(raw)
    return NextResponse.json(parsed, {
      headers: { "Cache-Control": "public, max-age=3600" },
    })
  } catch {
    return NextResponse.json([], { status: 200 })
  }
}
