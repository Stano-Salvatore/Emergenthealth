// Loads every main screen in a real browser and checks it is not broken.
//
//   node .ci/smoke.mjs                  # against a running dev server
//   BASE_URL=… node .ci/smoke.mjs       # or a deployment
//
// This exists because 432 unit tests passed while, on every phone-width
// dashboard screen, the Privacy and Terms links were printed on top of the
// bottom nav — and while the weather skeleton could pulse for the rest of the
// session. Neither is expressible as a unit test; both are obvious the moment
// something renders the page and looks. So the checks below are deliberately
// about the LAYOUT AS RENDERED, not about component behaviour:
//
//   · every screen answers 200 and throws no uncaught error
//   · nothing overlaps the fixed bottom nav
//   · no loading skeleton is still animating once the page has settled
//   · the page does not scroll sideways
//
// Requires a seeded local database (.ci/dev-seed.mjs) — the session cookie
// below is the row that script writes.
import { chromium } from "playwright-core"
import { existsSync, mkdirSync } from "node:fs"

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")
const TOKEN = process.env.SMOKE_TOKEN ?? "demo-session-token-local-only"
const OUT = process.env.OUT ?? ".ci/smoke-shots"
// Generous, because this runs against `next dev` as often as a build, and a
// cold Turbopack compile of a heavy route genuinely takes tens of seconds.
const NAV_TIMEOUT_MS = Number(process.env.SMOKE_NAV_TIMEOUT_MS ?? 45_000)
const CHROME = process.env.CHROMIUM_PATH
  ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined)

// 390px is where the collisions happen: the bottom nav only exists below `lg`,
// and it is the width the app is actually used at.
const WIDTH = Number(process.env.WIDTH ?? 390)
const HEIGHT = Number(process.env.HEIGHT ?? 844)

/** How long a skeleton may legitimately still be animating. */
// Longer than the longest bound the app sets itself. WeatherWidget waits up to
// 15s for a location fix before giving up and rendering its no-location state —
// a deliberate bound, because the geolocation spec's own timeout does not start
// until permission is granted, so a prompt that is swiped away rather than
// answered reaches no callback at all. Checking at 12s therefore reported a
// widget behaving exactly as designed: measured here, its skeleton is present
// at 12s and gone by 16s. A check that flags correct behaviour gets ignored.
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 18_000)

const ROUTES = (process.env.ROUTES ?? [
  "/dashboard",
  "/dashboard/chat",
  "/dashboard/health",
  "/dashboard/habits",
  "/dashboard/settings",
  "/dashboard/week",
  "/dashboard/experiments",
  "/dashboard/calendar",
  "/dashboard/garden",
].join(",")).split(",")

// Errors every build produces on the web and which say nothing about the page.
const IGNORED_ERRORS = [/"HealthConnect" plugin is not implemented on web/]

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROME })
const ctx = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2,
  isMobile: WIDTH < 500,
  hasTouch: WIDTH < 500,
})
await ctx.addCookies([{
  name: "authjs.session-token", value: TOKEN,
  domain: new URL(BASE).hostname, path: "/", httpOnly: true, sameSite: "Lax",
}])
// The dev-tools bubble is fixed to the same corner as the nav and would trip
// the overlap check as a false positive.
await ctx.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
  const s = document.createElement("style")
  s.textContent = "nextjs-portal{display:none!important}"
  document.head.append(s)
}))

const failures = []
const page = await ctx.newPage()

for (const route of ROUTES) {
  const errors = []
  const onError = e => errors.push(String(e))
  page.on("pageerror", onError)

  let status = "ERR"
  try {
    const res = await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS })
    status = res?.status() ?? "none"
  } catch (e) {
    // A dev server compiles each route on its first request, and the heavy
    // ones take longer than any sane navigation timeout. Reported as failures
    // that is five phantom problems on a cold run — and a check that cries
    // wolf gets ignored, which is worse than not having it. So the first
    // timeout per route buys a second attempt against the now-warm route, and
    // only the second one counts.
    let recovered = false
    try {
      const res = await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS })
      status = res?.status() ?? "none"
      recovered = true
    } catch { /* the retry's own failure is the one worth reporting */ }

    if (!recovered) {
      failures.push(`${route}: navigation failed twice — ${e.message.split("\n")[0]}`)
      page.off("pageerror", onError)
      continue
    }
  }

  // Best-effort: the dashboard polls and the chat page holds an open stream, so
  // neither ever reaches network idle.
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {})
  // A changelog modal opens over the first screen of a fresh session.
  for (const label of ["Got it, dismiss", "Got it"]) {
    const b = page.getByText(label, { exact: false }).first()
    if (await b.count() && await b.isVisible().catch(() => false)) {
      await b.click().catch(() => {})
      break
    }
  }
  // Poll rather than sleep the whole window. The bound exists for the slowest
  // thing the app gives itself — WeatherWidget's fifteen seconds — but almost
  // every screen is done in two, and paying the worst case on all nine turned a
  // one-minute check into four. Waiting only as long as something is still
  // pulsing keeps the same verdict at a fraction of the cost.
  {
    const deadline = Date.now() + SETTLE_MS
    for (;;) {
      // EXACTLY the predicate the report uses below, substring match and
      // zero-size exclusion included. A poll that stops on a different
      // question than the one asked at the end can stop while the report
      // would still count something — turning a merely slow screen into a
      // reported failure, which is the fault this whole change is undoing.
      const pulsing = await page.evaluate(() =>
        [...document.querySelectorAll("[class*='animate-pulse']")]
          .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
          .length,
      ).catch(() => 1)
      if (pulsing === 0 || Date.now() >= deadline) break
      await page.waitForTimeout(500)
    }
    // A short tail even once nothing pulses: a screen that has just swapped its
    // skeleton for content has not necessarily finished laying it out, and the
    // overlap and sideways-scroll checks below read geometry.
    await page.waitForTimeout(1_000)
  }

  if (status !== 200) failures.push(`${route}: HTTP ${status}`)

  const real = errors.filter(e => !IGNORED_ERRORS.some(re => re.test(e)))
  for (const e of new Set(real)) failures.push(`${route}: uncaught — ${e.slice(0, 160)}`)

  const report = await page.evaluate(() => {
    const out = { overlapping: [], pulsing: [], scrollsSideways: false }

    // 1. Anything sitting on top of the bottom nav. This is the exact shape of
    //    the Privacy/Terms bug: a `fixed bottom-0` element at a higher z-index
    //    than the nav, printed over its labels.
    const nav = document.querySelector("[class*='fixed'][class*='bottom-0'][class*='inset-x-0']")
    if (nav) {
      const n = nav.getBoundingClientRect()
      for (const el of document.querySelectorAll("body *")) {
        if (nav.contains(el) || el.contains(nav)) continue
        const cs = getComputedStyle(el)
        if (cs.position !== "fixed" || cs.visibility === "hidden" || cs.display === "none") continue
        if (!el.textContent?.trim()) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        const hits = !(r.right <= n.left || r.left >= n.right || r.bottom <= n.top || r.top >= n.bottom)
        // Only complain about things painted ABOVE the nav; anything behind it
        // is hidden by the nav's own background and harms nothing.
        if (hits && Number(cs.zIndex || 0) >= Number(getComputedStyle(nav).zIndex || 0)) {
          out.overlapping.push((el.tagName + "." + String(el.className).slice(0, 60)).trim())
        }
      }
    }

    // 2. A skeleton still animating long after the page settled is a loading
    //    state with no path out of it.
    for (const el of document.querySelectorAll("[class*='animate-pulse']")) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) out.pulsing.push(String(el.className).slice(0, 80))
    }

    // 3. Wide content that was never given its own scroll container.
    out.scrollsSideways = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1

    return out
  })

  for (const el of new Set(report.overlapping)) failures.push(`${route}: overlaps the bottom nav — ${el}`)
  for (const el of new Set(report.pulsing)) failures.push(`${route}: still loading after ${SETTLE_MS / 1000}s — ${el}`)
  if (report.scrollsSideways) failures.push(`${route}: page scrolls sideways at ${WIDTH}px`)

  await page.screenshot({ path: `${OUT}/${route.replace(/\W+/g, "_").replace(/^_/, "")}.png` })
  console.log(`${String(status).padEnd(5)} ${route}`)
  page.off("pageerror", onError)
}

await browser.close()

if (failures.length) {
  console.error(`\n${failures.length} problem(s):`)
  for (const f of failures) console.error("  ✗ " + f)
  console.error(`\nScreenshots in ${OUT}/`)
  process.exit(1)
}
console.log(`\nAll ${ROUTES.length} screens clean. Screenshots in ${OUT}/`)
