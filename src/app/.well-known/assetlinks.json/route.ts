import { NextResponse } from "next/server"

const ASSETLINKS = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "app.emergenthealth",
      sha256_cert_fingerprints: [
        "DC:6A:BF:F5:2F:BC:84:2F:93:30:FF:21:B5:2C:A6:5E:F4:C7:55:E3:AE:0C:3F:73:94:7D:68:CC:D2:BC:BE:AD",
      ],
    },
  },
]

export async function GET() {
  return NextResponse.json(ASSETLINKS, {
    headers: { "Cache-Control": "public, max-age=3600" },
  })
}
