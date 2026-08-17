// Builds the Android launcher icon from the brand mark.
//
// This used to write the PWA icon into the legacy mipmap PNGs and then delete
// mipmap-anydpi-v26 so those PNGs would win. That worked in the sense that the
// stock Capacitor icon was gone, but it also opted the app out of adaptive
// icons — and on API 26+ a launcher handed a legacy icon shrinks it and drops
// it on a white circle. So the installed app showed a small purple square
// floating on white, which is not what the mark looks like.
//
// The fix is to ship the adaptive icon properly: a background layer, a
// foreground layer inset into the safe zone, and a monochrome layer so Android
// 13+ themed icons get a silhouette rather than falling back to the same
// legacy treatment. Legacy PNGs stay for pre-API-26 devices.
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import {
  squareIcon,
  adaptiveBackground,
  adaptiveForeground,
  monochromeForeground,
  emergySilhouette,
  emergyColorIcon,
} from "./brand-icon.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const resDir = join(__dirname, "..", "android/app/src/main/res")

// Legacy icons are 48dp; adaptive layers are 108dp. Both scale by density.
const DENSITIES = {
  "mipmap-mdpi": 1,
  "mipmap-hdpi": 1.5,
  "mipmap-xhdpi": 2,
  "mipmap-xxhdpi": 3,
  "mipmap-xxxhdpi": 4,
}

// The notification small icon is 24dp and belongs in drawable-*, which is
// where capacitor.config.ts's LocalNotifications.smallIcon resolves it from.
// The large icon is the full-colour picture in the notification shade, 64dp.
const LARGE_ICON_DENSITIES = {
  "drawable-mdpi": 64,
  "drawable-hdpi": 96,
  "drawable-xhdpi": 128,
  "drawable-xxhdpi": 192,
  "drawable-xxxhdpi": 256,
}

const NOTIFICATION_DENSITIES = {
  "drawable-mdpi": 24,
  "drawable-hdpi": 36,
  "drawable-xhdpi": 48,
  "drawable-xxhdpi": 72,
  "drawable-xxxhdpi": 96,
}

async function render(svgMarkup, size, out) {
  await sharp(Buffer.from(svgMarkup)).resize(size, size).png().toFile(out)
}

const ADAPTIVE_XML =
  `<?xml version="1.0" encoding="utf-8"?>\n` +
  `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n` +
  `    <background android:drawable="@mipmap/ic_launcher_bg"/>\n` +
  `    <foreground android:drawable="@mipmap/ic_launcher_fg"/>\n` +
  `    <monochrome android:drawable="@mipmap/ic_launcher_mono"/>\n` +
  `</adaptive-icon>\n`

async function main() {
  if (!existsSync(resDir)) {
    console.warn(`WARNING: Android res dir not found at ${resDir} — skipping icon generation`)
    return
  }

  // The mark with its own rounded corners, for launchers that show the icon
  // as-is. 0.88 keeps the pulse clear of the rounding.
  const legacy = squareIcon({ radius: 108, scale: 0.88 })
  const background = adaptiveBackground()
  const foreground = adaptiveForeground()
  const monochrome = monochromeForeground()

  for (const [dir, factor] of Object.entries(DENSITIES)) {
    const outDir = join(resDir, dir)
    mkdirSync(outDir, { recursive: true })

    const legacySize = Math.round(48 * factor)
    const adaptiveSize = Math.round(108 * factor)

    await render(legacy, legacySize, join(outDir, "ic_launcher.png"))
    await render(legacy, legacySize, join(outDir, "ic_launcher_round.png"))
    await render(background, adaptiveSize, join(outDir, "ic_launcher_bg.png"))
    await render(foreground, adaptiveSize, join(outDir, "ic_launcher_fg.png"))
    await render(monochrome, adaptiveSize, join(outDir, "ic_launcher_mono.png"))

    console.log(`✓ ${dir} — legacy ${legacySize}px, adaptive ${adaptiveSize}px`)
  }

  // Capacitor's template ships its own foreground/background drawables here;
  // overwriting the XML points the adaptive icon at ours instead.
  const anydpi = join(resDir, "mipmap-anydpi-v26")
  mkdirSync(anydpi, { recursive: true })
  for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
    writeFileSync(join(anydpi, name), ADAPTIVE_XML)
  }
  console.log("✓ mipmap-anydpi-v26 — adaptive icon (background + foreground + monochrome)")

  const emergyStat = emergySilhouette()
  for (const [dir, size] of Object.entries(NOTIFICATION_DENSITIES)) {
    const outDir = join(resDir, dir)
    mkdirSync(outDir, { recursive: true })
    await render(emergyStat, size, join(outDir, "ic_stat_emergy.png"))
  }
  console.log("✓ drawable-* — ic_stat_emergy (white silhouette, 24dp)")

  const emergyLarge = emergyColorIcon()
  for (const [dir, size] of Object.entries(LARGE_ICON_DENSITIES)) {
    const outDir = join(resDir, dir)
    mkdirSync(outDir, { recursive: true })
    await render(emergyLarge, size, join(outDir, "ic_emergy_large.png"))
  }
  console.log("✓ drawable-* — ic_emergy_large (full colour, 64dp)")

  console.log("Android launcher icon rebuilt from the brand mark.")
}

main().catch(err => {
  console.error("Icon generation failed:", err)
  process.exit(1)
})
