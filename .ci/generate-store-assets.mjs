// Builds the two graphics Play Console asks for on the store listing page.
//
// Neither is taken from the app bundle — Play wants them uploaded separately,
// and the listing cannot be submitted without both. Their output is committed
// under play-store/assets/ rather than built in CI, because they are uploaded
// by hand once rather than consumed by a build.
//
//   npm run store-assets
//
// Play's rules, which the sizes and formats below satisfy:
//   icon     512×512, 32-bit PNG, ≤1MB, square — Play applies its own corner
//            mask, so the source must NOT be pre-rounded or the edge shows a
//            double curve
//   feature  1024×500, PNG or JPEG, no alpha, no rounded corners. It gets
//            cropped on some surfaces, so nothing important goes near an edge.
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import { squareIcon, BG_FROM, BG_TO, PULSE_FROM } from "./brand-icon.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, "..", "play-store/assets")

const NAME = "Emergenthealth"
const TAGLINE = "Your AI health companion"
const SUB = "Habits · Sleep · Mood · Wearables"

// Liberation Sans is metric-compatible with Arial and present on the CI image
// and most Linux desktops; the fallbacks cover macOS and anything else.
const FONT = "Liberation Sans, Helvetica, Arial, sans-serif"

function featureGraphic() {
  const W = 1024
  const H = 500
  // Icon block on the left, text to its right, everything inside a 64px margin
  // so Play's centre-crop on smaller surfaces doesn't cut the wordmark.
  const iconSize = 260
  const iconX = 72
  const iconY = (H - iconSize) / 2
  const textX = iconX + iconSize + 56

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs>` +
      `<linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">` +
        `<stop offset="0%" stop-color="#0b0a1f"/>` +
        `<stop offset="55%" stop-color="${BG_FROM}"/>` +
        `<stop offset="100%" stop-color="${BG_TO}"/>` +
      `</linearGradient>` +
      `<linearGradient id="pulse" x1="0%" y1="0%" x2="100%" y2="0%">` +
        `<stop offset="0%" stop-color="${PULSE_FROM}" stop-opacity="0"/>` +
        `<stop offset="35%" stop-color="${PULSE_FROM}" stop-opacity="0.5"/>` +
        `<stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>` +
      `</linearGradient>` +
    `</defs>` +
    `<rect width="${W}" height="${H}" fill="url(#bg)"/>` +
    // A faint pulse trace across the full width, echoing the icon. Kept low
    // and shifted right of the icon block so the two marks don't tangle.
    `<polyline points="0,432 520,432 556,372 592,492 628,396 658,468 688,432 1024,432" ` +
      `fill="none" stroke="url(#pulse)" stroke-width="6" stroke-linecap="round" ` +
      `stroke-linejoin="round" opacity="0.55"/>` +
    `<g transform="translate(${iconX},${iconY})">` +
      `<rect width="${iconSize}" height="${iconSize}" rx="58" fill="#ffffff" opacity="0.08"/>` +
      `<image x="16" y="16" width="${iconSize - 32}" height="${iconSize - 32}" ` +
        `href="ICON_DATA_URI"/>` +
    `</g>` +
    `<text x="${textX}" y="212" font-family="${FONT}" font-size="72" font-weight="bold" ` +
      `fill="#ffffff" letter-spacing="-1.5">${NAME}</text>` +
    `<text x="${textX}" y="272" font-family="${FONT}" font-size="34" ` +
      `fill="#c7d2fe">${TAGLINE}</text>` +
    `<text x="${textX}" y="326" font-family="${FONT}" font-size="25" ` +
      `fill="#a5b4fc" opacity="0.85">${SUB}</text>` +
    `</svg>`
  )
}

async function main() {
  mkdirSync(outDir, { recursive: true })

  // ── Store listing icon ────────────────────────────────────────────────────
  // Square, opaque, full-bleed. `flatten` guarantees no alpha channel survives
  // even if the renderer leaves one behind.
  const icon = await sharp(Buffer.from(squareIcon({ radius: 0, scale: 0.86 })))
    .resize(512, 512)
    .flatten({ background: BG_FROM })
    .png({ compressionLevel: 9 })
    .toBuffer()
  await sharp(icon).toFile(join(outDir, "icon-512.png"))
  console.log(`✓ icon-512.png (${(icon.length / 1024).toFixed(0)} KB)`)

  // ── Feature graphic ───────────────────────────────────────────────────────
  // The icon is inlined as a data URI: librsvg will not follow a relative
  // href out of an in-memory buffer.
  const inlineIcon = await sharp(Buffer.from(squareIcon({ radius: 96, scale: 0.86 })))
    .resize(512, 512)
    .png()
    .toBuffer()
  const markup = featureGraphic().replace(
    "ICON_DATA_URI",
    `data:image/png;base64,${inlineIcon.toString("base64")}`
  )
  const feature = await sharp(Buffer.from(markup))
    .flatten({ background: "#0b0a1f" })
    .png({ compressionLevel: 9 })
    .toBuffer()
  await sharp(feature).toFile(join(outDir, "feature-graphic-1024x500.png"))
  console.log(`✓ feature-graphic-1024x500.png (${(feature.length / 1024).toFixed(0)} KB)`)

  // ── Verify against Play's rules rather than trusting the above ────────────
  const checks = [
    ["icon-512.png", 512, 512, 1024],
    ["feature-graphic-1024x500.png", 1024, 500, 15360],
  ]
  let failed = false
  for (const [file, w, h, maxKB] of checks) {
    const path = join(outDir, file)
    const meta = await sharp(path).metadata()
    const stats = await sharp(path).stats()
    const kb = Math.round((await sharp(path).toBuffer()).length / 1024)
    const problems = []
    if (meta.width !== w || meta.height !== h) problems.push(`size ${meta.width}×${meta.height}, want ${w}×${h}`)
    if (!stats.isOpaque) problems.push("has transparency — Play rejects alpha here")
    if (kb > maxKB) problems.push(`${kb} KB exceeds ${maxKB} KB`)
    if (problems.length) {
      failed = true
      console.error(`✗ ${file}: ${problems.join("; ")}`)
    } else {
      console.log(`  ${file}: ${meta.width}×${meta.height}, opaque, ${kb} KB — ok`)
    }
  }
  if (failed) process.exit(1)
}

main().catch(err => {
  console.error("Store asset generation failed:", err)
  process.exit(1)
})
