// Screenshot every dashboard page, signed in as the seeded demo account, with
// the browser's clock shifted to FAKE_NOW and its timezone set to TZ_ID —
// start the server with the same FAKE_NOW through .ci/fake-clock.cjs first,
// or the two halves will disagree about what day it is (which is, in fact,
// the bug this exists to show).
//
//   FAKE_NOW=2026-09-22T22:30:00Z OUT=.ci/shots-0030 node .ci/render-at.mjs
//
// Unlike smoke.mjs this judges nothing; it writes a PNG and the page's text
// per route so two runs can be diffed. ROUTES=/dashboard,/dashboard/week
// narrows it.
import { chromium } from "playwright-core"
import { mkdirSync, writeFileSync } from "node:fs"

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")
const OUT = process.env.OUT ?? ".ci/render-shots"
const FAKE_NOW = process.env.FAKE_NOW ?? null
const TZ = process.env.TZ_ID ?? "Europe/Bratislava"
const ROUTES = (process.env.ROUTES ?? [
  "/dashboard","/dashboard/body","/dashboard/brief","/dashboard/caffeine","/dashboard/calendar",
  "/dashboard/chat","/dashboard/checkin","/dashboard/custom","/dashboard/experiments","/dashboard/fasting",
  "/dashboard/focus","/dashboard/garden","/dashboard/gmail","/dashboard/habits","/dashboard/health",
  "/dashboard/home","/dashboard/insights","/dashboard/intake","/dashboard/journal","/dashboard/labs",
  "/dashboard/lastfm","/dashboard/location","/dashboard/medications","/dashboard/reading","/dashboard/reminders",
  "/dashboard/report","/dashboard/rescuetime","/dashboard/settings","/dashboard/stats","/dashboard/strava",
  "/dashboard/streaks","/dashboard/symptoms","/dashboard/timeline","/dashboard/toggl","/dashboard/week","/dashboard/weight",
].join(",")).split(",")

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, timezoneId: TZ,
})
await ctx.addCookies([{ name: "authjs.session-token", value: "demo-session-token-local-only", domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }])
if (FAKE_NOW) {
  await ctx.addInitScript(`(() => {
    const RealDate = Date; const offset = new RealDate(${JSON.stringify(FAKE_NOW)}).getTime() - RealDate.now();
    class FakeDate extends RealDate { constructor(...a){ if (a.length===0) super(RealDate.now()+offset); else super(...a) } static now(){ return RealDate.now()+offset } }
    FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse; globalThis.Date = FakeDate;
  })()`)
}
await ctx.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "nextjs-portal{display:none!important}"; document.head.append(s) }))
const page = await ctx.newPage()
const report = []
for (const route of ROUTES) {
  const errors = []; const api = []
  const onErr = e => errors.push(String(e).split("\n")[0])
  const onRes = r => { const u = r.url(); if (u.includes("/api/") && r.status() >= 400) api.push(`${r.status()} ${u.replace(BASE, "")}`) }
  page.on("pageerror", onErr); page.on("response", onRes)
  let status = null
  try {
    const res = await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 90000 }); status = res?.status() ?? null
    await page.waitForTimeout(2500)
  } catch (e) { errors.push("nav: " + String(e).split("\n")[0]) }
  const name = route.replace(/\//g, "_").replace(/^_/, "") || "root"
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => {})
  const text = await page.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText).catch(() => "")
  writeFileSync(`${OUT}/${name}.txt`, text)
  report.push({ route, status, url: page.url().replace(BASE, ""), errors, api })
  page.off("pageerror", onErr); page.off("response", onRes)
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))
for (const r of report) console.log(`${r.status} ${r.route}${r.url !== r.route ? " -> " + r.url : ""}${r.errors.length ? " ERR " + r.errors.join(" | ") : ""}${r.api.length ? " API " + r.api.join(", ") : ""}`)
await browser.close()
