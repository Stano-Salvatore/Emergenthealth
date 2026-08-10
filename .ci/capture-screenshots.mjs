// Captures the phone screenshots Play Console needs for the store listing.
//
//   BASE_URL=https://emergenthealth.vercel.app \
//   DEMO_USERNAME=... DEMO_PASSWORD=... \
//   npm run screenshots
//
// Two things this deliberately does NOT do:
//
//   It never signs in as the owner. Screenshots go on a public store listing,
//   so they are taken against the seeded demo account and show invented data.
//   Point it at a real account and you publish that person's health history.
//
//   It does not fake a phone by shrinking a desktop render. The context is a
//   real mobile emulation — 360×640 CSS at 3×, which is exactly Play's
//   canonical 1080×1920 — so Tailwind resolves its mobile breakpoints and the
//   result is the layout a phone actually gets.
//
// The user-agent carries the Capacitor suffix because the shipped app sets it,
// and parts of the UI (pricing, checkout) hide themselves when they see it. A
// plain browser UA would screenshot a build no Play user ever sees.
import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"
import sharp from "sharp"

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, "..", "play-store/assets/screenshots")

const BASE_URL = (process.env.BASE_URL ?? "https://emergenthealth.vercel.app").replace(/\/$/, "")
const USERNAME = process.env.DEMO_USERNAME
const PASSWORD = process.env.DEMO_PASSWORD

// Playwright ships browsers at PLAYWRIGHT_BROWSERS_PATH; playwright-core does
// not download any, so the executable is named explicitly.
const CHROME =
  process.env.CHROMIUM_PATH ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined)

const CSS_WIDTH = 360
const CSS_HEIGHT = 640
const SCALE = 3 // ⇒ 1080×1920, Play's canonical phone size and an exact 9:16

const SHOTS = [
  { file: "01-overview.png",     path: "/dashboard",                          wait: "Today" },
  { file: "02-emergy-chat.png",  path: "/dashboard/chat",                     wait: null },
  { file: "03-correlations.png", path: "/dashboard/health?tab=correlations",  wait: null },
  { file: "04-habits.png",       path: "/dashboard/habits",                   wait: null },
  { file: "05-garden.png",       path: "/dashboard/garden",                   wait: null },
  { file: "06-calendar.png",     path: "/dashboard/calendar",                 wait: null },
]

async function settle(page, hint) {
  // networkidle alone is unreliable here: the dashboard polls and the chat page
  // holds an open stream, so it can never go idle. Treat it as best-effort.
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {})
  if (hint) {
    await page.getByText(hint, { exact: false }).first()
      .waitFor({ timeout: 8000 }).catch(() => {})
  }
  // Charts and the garden animate in; give them a beat to reach a resting state.
  await page.waitForTimeout(2500)
}

async function main() {
  if (!USERNAME || !PASSWORD) {
    console.error(
      "DEMO_USERNAME and DEMO_PASSWORD must be set.\n" +
      "These are the reviewer credentials from Vercel — the same pair configured\n" +
      "for /api/credentials-signin. Screenshots are taken as the demo account so\n" +
      "no real health data reaches the store listing."
    )
    process.exit(1)
  }

  mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ executablePath: CHROME })
  const context = await browser.newContext({
    viewport: { width: CSS_WIDTH, height: CSS_HEIGHT },
    deviceScaleFactor: SCALE,
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/130.0.0.0 Mobile Safari/537.36 Emergenthealth-Capacitor",
  })

  // Must be registered before any page exists, so it runs ahead of first paint.
  // The install prompt is correct in the app but eats the top of a screenshot,
  // and layout_mode defaults to mobile only until someone has toggled it.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("layout_mode", "mobile")
      localStorage.setItem("pwa_prompt_dismissed", "1")
    } catch {}
  })

  // Sign in through the API rather than the form: context.request shares this
  // context's cookie jar, so the session cookie is in place for every page below.
  const res = await context.request.post(`${BASE_URL}/api/credentials-signin`, {
    data: { username: USERNAME, password: PASSWORD },
  })
  if (!res.ok()) {
    const body = await res.text().catch(() => "")
    console.error(
      `Sign-in failed: HTTP ${res.status()} ${body.slice(0, 200)}\n` +
      `A 404 here means DEMO_USERNAME/DEMO_PASSWORD/DEMO_EMAIL are not set on ` +
      `the deployment at ${BASE_URL} — password sign-in fails closed when unconfigured.`
    )
    await browser.close()
    process.exit(1)
  }

  const page = await context.newPage()

  const captured = []
  for (const shot of SHOTS) {
    const url = `${BASE_URL}${shot.path}`
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 })

    if (page.url().includes("/signin")) {
      console.error(`✗ ${shot.file}: bounced to /signin — the session did not stick`)
      await browser.close()
      process.exit(1)
    }

    await settle(page, shot.wait)
    const out = join(outDir, shot.file)
    await page.screenshot({ path: out })
    captured.push(out)
    console.log(`✓ ${shot.file}  ${shot.path}`)
  }

  await browser.close()

  // ── Check against Play's rules rather than assuming ───────────────────────
  // Phone screenshots: 2–8 of them, 320–3840px per side, ratio no more extreme
  // than 2:1 either way, ≤8MB each.
  let failed = false
  for (const file of captured) {
    const meta = await sharp(file).metadata()
    const kb = Math.round((await sharp(file).toBuffer()).length / 1024)
    const ratio = meta.height / meta.width
    const problems = []
    if (Math.min(meta.width, meta.height) < 320) problems.push(`shortest side ${Math.min(meta.width, meta.height)}px < 320`)
    if (Math.max(meta.width, meta.height) > 3840) problems.push(`longest side ${Math.max(meta.width, meta.height)}px > 3840`)
    if (ratio > 2 || ratio < 0.5) problems.push(`ratio ${ratio.toFixed(2)} outside 2:1`)
    if (kb > 8192) problems.push(`${kb} KB > 8 MB`)
    if (problems.length) {
      failed = true
      console.error(`✗ ${file}: ${problems.join("; ")}`)
    }
  }
  if (captured.length < 2 || captured.length > 8) {
    failed = true
    console.error(`✗ Play wants 2–8 phone screenshots; captured ${captured.length}`)
  }
  if (failed) process.exit(1)

  console.log(
    `\n${captured.length} screenshots at ${CSS_WIDTH * SCALE}×${CSS_HEIGHT * SCALE} in play-store/assets/screenshots/\n` +
    `Look at them before uploading — a half-loaded chart is worse than no screenshot.`
  )
}

main().catch(err => {
  console.error("Screenshot capture failed:", err)
  process.exit(1)
})
