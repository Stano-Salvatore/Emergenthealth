// Replaces Capacitor's default (generic blue) launcher icon with the app's
// own branded icon (public/icons/icon-512.png — purple gradient + pulse line,
// already used as the PWA icon). Nothing in this pipeline previously touched
// the Android launcher icon, so every APK build shipped Capacitor's stock
// template icon unchanged.
//
// This overwrites the legacy per-density mipmap PNGs and removes the
// adaptive-icon XML (mipmap-anydpi-v26), which otherwise takes priority on
// API 26+ and would keep pointing at Capacitor's own foreground/background
// drawables even after the legacy PNGs are replaced.
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, "..")
const source = join(repoRoot, "public/icons/icon-512.png")
const resDir = join(repoRoot, "android/app/src/main/res")

const DENSITIES = {
  "mipmap-mdpi": 48,
  "mipmap-hdpi": 72,
  "mipmap-xhdpi": 96,
  "mipmap-xxhdpi": 144,
  "mipmap-xxxhdpi": 192,
}

async function main() {
  if (!existsSync(source)) {
    console.warn(`WARNING: icon source not found at ${source} — skipping icon generation`)
    return
  }
  if (!existsSync(resDir)) {
    console.warn(`WARNING: Android res dir not found at ${resDir} — skipping icon generation`)
    return
  }

  for (const [dir, size] of Object.entries(DENSITIES)) {
    const outDir = join(resDir, dir)
    mkdirSync(outDir, { recursive: true })
    for (const name of ["ic_launcher.png", "ic_launcher_round.png"]) {
      const out = join(outDir, name)
      await sharp(source).resize(size, size).png().toFile(out)
    }
    console.log(`✓ ${dir} (${size}x${size})`)
  }

  // Remove the adaptive-icon declaration so Android falls back to the legacy
  // PNGs above on every API level, instead of keeping Capacitor's own
  // foreground/background layers (which take priority on API 26+).
  const anydpi = join(resDir, "mipmap-anydpi-v26")
  if (existsSync(anydpi)) {
    rmSync(anydpi, { recursive: true, force: true })
    console.log("✓ removed stale adaptive-icon XML (mipmap-anydpi-v26)")
  }

  console.log("Android launcher icon replaced with app branding.")
}

main().catch(err => {
  console.error("Icon generation failed:", err)
  process.exit(1)
})
