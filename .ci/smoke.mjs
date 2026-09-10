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
// What this check is actually for is a loading state with NO PATH OUT of it.
// Three times today a fixed deadline reported one that had a path out and was
// merely walking it: the dashboard takes ~28s to settle on a loaded dev server
// (23 skeletons at 8s, 13 at 18s, 0 at 28s) and every raise just moved the
// goalposts. So the signal is STALLED, not SLOW — a page still retiring
// skeletons is fine however long it takes; one that has stopped retiring them
// is the bug.
//
// The floor exists because "stopped changing" is not enough on its own:
// WeatherWidget deliberately holds a single skeleton for a fixed fifteen
// seconds, waiting on a location fix that the geolocation spec will never time
// out (its clock starts only once permission is granted, so a prompt swiped
// away reaches no callback at all). Below the floor, a steady count is that
// widget behaving correctly.
const SETTLE_FLOOR_MS = Number(process.env.SETTLE_FLOOR_MS ?? 16_000)
/** No skeleton retired in this long, past the floor, means stuck rather than slow. */
const SETTLE_STALL_MS = Number(process.env.SETTLE_STALL_MS ?? 5_000)
/** Absolute bound, so a genuinely broken page cannot hang the run. */
const SETTLE_MAX_MS = Number(process.env.SETTLE_MAX_MS ?? 60_000)

// EVERY page, not a curated subset. This list started as eight "main"
// screens, and the page this project spent a week changing — Insights —
// was not one of them. A route that exists is a route someone opens; a
// sweep that skips it protects nothing. Keep in sync with
// `find src/app/dashboard -name page.tsx` (the run fails loudly if a
// listed route 404s, so drift is caught in the failing direction).
const ROUTES = (process.env.ROUTES ?? [
  "/dashboard",
  "/dashboard/bills",
  "/dashboard/body",
  "/dashboard/brief",
  "/dashboard/caffeine",
  "/dashboard/calendar",
  "/dashboard/chat",
  "/dashboard/checkin",
  "/dashboard/custom",
  "/dashboard/experiments",
  "/dashboard/fasting",
  "/dashboard/finances",
  "/dashboard/focus",
  "/dashboard/garden",
  "/dashboard/gmail",
  "/dashboard/habits",
  "/dashboard/health",
  "/dashboard/home",
  "/dashboard/insights",
  "/dashboard/intake",
  "/dashboard/journal",
  "/dashboard/labs",
  "/dashboard/lastfm",
  "/dashboard/location",
  "/dashboard/medications",
  "/dashboard/reading",
  "/dashboard/reminders",
  "/dashboard/report",
  "/dashboard/rescuetime",
  "/dashboard/settings",
  "/dashboard/stats",
  "/dashboard/strava",
  "/dashboard/streaks",
  "/dashboard/subscriptions",
  "/dashboard/symptoms",
  "/dashboard/timeline",
  "/dashboard/toggl",
  "/dashboard/week",
  "/dashboard/weight",
].join(",")).split(",")

// Errors every build produces on the web and which say nothing about the page.
const IGNORED_ERRORS = [
  // Redundant by construction: a resource that fails by STATUS is caught by
  // the response listener (with the URL and code), one that fails at the
  // NETWORK level by the requestfailed listener (with the URL and reason).
  // The console's version of either carries less information than the copy
  // already reported, and doubling every finding teaches people to skim.
  /^Failed to load resource/,
  // Vercel Analytics' self-hosted route exists only when deployed on
  // Vercel; `next start` answers its 404 with an HTML page and the
  // browser refuses the MIME. Only ever fires OFF Vercel, so it can never
  // mask a real analytics failure on the deployment.
  /_vercel\/insights\//,
]

// External hosts whose failure is environment, not application: analytics
// being unreachable (offline phone, an egress-filtered CI box, an ad
// blocker) is a state the app must and does tolerate silently.
const EXTERNAL_NOISE = [/^https:\/\/va\.vercel-scripts\.com\//]

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
const redirects = []
const warnings = []
const page = await ctx.newPage()

// A page can render a perfectly calm empty state over an API that is on
// fire. pageerror only hears exceptions that escape to the top; a fetch
// whose 500 was caught and turned into "no data yet" says nothing there —
// and that is exactly the bug a person clicking around would not catch.
// So the sweep also listens to the network and the console:
//   · a same-origin /api response of 500+ fails the route outright
//   · a 4xx or a console.error is reported as a warning — some are
//     legitimate (a source that isn't connected), and a warning that
//     turns out to always be noise can be added to IGNORED_ERRORS,
//     but silently is the one way this list must not grow.
const API = new URL(BASE).origin + "/api/"

for (const route of ROUTES) {
  const errors = []
  const onError = e => errors.push(String(e))
  const onConsole = msg => {
    if (msg.type() !== "error") return
    const text = msg.text()
    if (IGNORED_ERRORS.some(re => re.test(text))) return
    warnings.push(`${route}: console.error — ${text.split("\n")[0].slice(0, 200)}`)
  }
  const onResponse = res => {
    const url = res.url()
    if (!url.startsWith(API)) return
    const st = res.status()
    const short = url.slice(new URL(BASE).origin.length)
    // The one 5xx a local run legitimately produces: /api/briefing answers
    // 503 when ANTHROPIC_API_KEY is unset, which local dev never sets. Scoped
    // to exactly that route and status so any other 503 still fails.
    if (st === 503 && short.startsWith("/api/briefing")) {
      warnings.push(`${route}: API 503 on ${short} (briefing without ANTHROPIC_API_KEY — expected locally)`)
    } else if (st >= 500) errors.push(`API ${st} on ${short}`)
    // The seeded demo account has no external services attached, and the
    // sync endpoints answer a not-connected POST "with a quick 4xx" by
    // documented contract (AutoSync fires them all on app open). Labelled
    // rather than hidden: a 4xx from any OTHER route is still bare signal.
    else if (st === 400 && /^\/api\/(sync\/\w+|lastfm|rescuetime)$/.test(short.split("?")[0])) {
      warnings.push(`${route}: API 400 on ${short} (source not connected — the documented answer)`)
    }
    else if (st >= 400) warnings.push(`${route}: API ${st} on ${short}`)
  }
  const onRequestFailed = req => {
    const failure = req.failure()?.errorText ?? "unknown"
    // Navigating away aborts in-flight requests; that is the sweep's own
    // doing, not the page's.
    if (failure === "net::ERR_ABORTED") return
    if (EXTERNAL_NOISE.some(re => re.test(req.url()))) return
    const short = req.url().startsWith(new URL(BASE).origin) ? req.url().slice(new URL(BASE).origin.length) : req.url()
    warnings.push(`${route}: request failed — ${failure} ${short.slice(0, 160)}`)
  }
  page.on("pageerror", onError)
  page.on("console", onConsole)
  page.on("response", onResponse)
  page.on("requestfailed", onRequestFailed)

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
      page.off("console", onConsole)
      page.off("response", onResponse)
      page.off("requestfailed", onRequestFailed)
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
  // Wait for the page to stop retiring skeletons, not for a clock to run out.
  {
    const started = Date.now()
    let best = Infinity
    let lastProgress = Date.now()
    for (;;) {
      // EXACTLY the predicate the report uses below, substring match and
      // zero-size exclusion included. A poll that stops on a different
      // question than the one asked at the end can stop while the report
      // would still count something — turning a merely slow screen into a
      // reported failure, which is the fault this whole change is undoing.
      const pulsing = await page.evaluate(() =>
        [...document.querySelectorAll("[class*='animate-pulse']:not([data-pulse])")]
          .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
          .length,
      ).catch(() => 1)

      if (pulsing === 0) break
      if (pulsing < best) { best = pulsing; lastProgress = Date.now() }

      const elapsed = Date.now() - started
      if (elapsed >= SETTLE_MAX_MS) break
      if (elapsed >= SETTLE_FLOOR_MS && Date.now() - lastProgress >= SETTLE_STALL_MS) break
      await page.waitForTimeout(500)
    }
    // A short tail even once nothing pulses: a screen that has just swapped its
    // skeleton for content has not necessarily finished laying it out, and the
    // overlap and sideways-scroll checks below read geometry.
    await page.waitForTimeout(1_000)
  }

  if (status !== 200) failures.push(`${route}: HTTP ${status}`)

  // A held-back feature redirects to /dashboard, and a 200 on the dashboard
  // is not evidence about the page that was asked for. Five routes were
  // reporting clean while the screenshot underneath them was the home screen.
  const landed = new URL(page.url()).pathname
  if (landed !== route) redirects.push(`${route} → ${landed}`)

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
    // `data-pulse` opts an element out: a pulse that MEANS something — the
    // red badge on the Emergy button saying he has something for you — is not
    // a skeleton, and reporting it as one is the fourth false alarm this file
    // exists to prevent. Anything that pulses without declaring itself still
    // fails, which is the right default: say what your animation is for.
    for (const el of document.querySelectorAll("[class*='animate-pulse']:not([data-pulse])")) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) out.pulsing.push(String(el.className).slice(0, 80))
    }

    // 3. Wide content that was never given its own scroll container.
    out.scrollsSideways = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1

    return out
  })

  for (const el of new Set(report.overlapping)) failures.push(`${route}: overlaps the bottom nav — ${el}`)
  for (const el of new Set(report.pulsing)) failures.push(`${route}: stuck loading — ${el}`)
  if (report.scrollsSideways) failures.push(`${route}: page scrolls sideways at ${WIDTH}px`)

  await page.screenshot({ path: `${OUT}/${route.replace(/\W+/g, "_").replace(/^_/, "")}.png` })
  const note = landed === route ? "" : `  → ${landed}`
  console.log(`${String(status).padEnd(5)} ${route}${note}`)
  page.off("pageerror", onError)
  page.off("console", onConsole)
  page.off("response", onResponse)
  page.off("requestfailed", onRequestFailed)
}

await browser.close()

// Not a failure — a held-back feature is meant to redirect. But it has to be
// said out loud, or the run reads as forty pages checked when it was
// thirty-five and the home screen five times over.
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s) — not failures, but each one is either a bug or a candidate for IGNORED_ERRORS, never for ignoring silently:`)
  for (const w of [...new Set(warnings)]) console.log("  ~ " + w)
}

if (redirects.length) {
  console.log(`\n${redirects.length} route(s) redirected — the screenshot is of the destination, not the route:`)
  for (const r of redirects) console.log("  · " + r)
}

if (failures.length) {
  console.error(`\n${failures.length} problem(s):`)
  for (const f of failures) console.error("  ✗ " + f)
  console.error(`\nScreenshots in ${OUT}/`)
  process.exit(1)
}
console.log(`\nAll ${ROUTES.length} screens clean${redirects.length ? ` (${redirects.length} redirected)` : ""}. Screenshots in ${OUT}/`)
