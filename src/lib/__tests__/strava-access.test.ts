import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { NextRequest } from "next/server"

// Strava admits one athlete to a new API app — the developer — until it
// approves a higher limit. Every other account that tapped "Connect Strava"
// landed on Strava's own "Error 403: Limit of connected athletes exceeded",
// a dead end the app had sent them to. Until Strava raises the limit
// (STRAVA_OPEN=1 then), the offer is shown only to accounts it can work for.

const state = vi.hoisted(() => ({ email: "friend@example.com", connected: false, everConnected: false, user: "u1" }))

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: state.user } }) }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: async () => ({ email: state.email }) },
    $queryRaw: async () => (state.connected ? [{ userId: state.user }] : []),
    userPreference: { findUnique: async () => (state.everConnected ? { value: "true" } : null) },
  },
}))

import { stravaOffered } from "@/lib/strava-access"
import { GET as STRAVA_AUTH } from "@/app/api/strava/auth/route"

const strip = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const saved = { ...process.env }

beforeEach(() => {
  state.email = "friend@example.com"
  state.connected = false
  state.everConnected = false
  process.env.FEEDBACK_NOTIFY_EMAIL = "owner@example.com"
  process.env.STRAVA_CLIENT_ID = "123"
  process.env.AUTH_SECRET = "test-secret"
  delete process.env.STRAVA_OPEN
})
afterEach(() => { process.env = { ...saved } })

describe("who is offered Strava", () => {
  it("the owner is", async () => {
    state.email = "Owner@Example.com"
    expect(await stravaOffered("u1")).toBe(true)
  })

  it("anyone else is not, while Strava's limit stands", async () => {
    expect(await stravaOffered("u1")).toBe(false)
  })

  it("an account already connected keeps it — it is inside the limit", async () => {
    state.connected = true
    expect(await stravaOffered("u1")).toBe(true)
  })

  it("an account that disconnected can reconnect — Strava still counts it inside the limit", async () => {
    state.everConnected = true
    expect(await stravaOffered("u1")).toBe(true)
  })

  it("everyone is, once STRAVA_OPEN=1", async () => {
    process.env.STRAVA_OPEN = "1"
    expect(await stravaOffered("u1")).toBe(true)
  })
})

describe("the connect route doesn't send anyone to Strava's 403", () => {
  it("an account not offered it is sent back with a reason, not to Strava", async () => {
    const res = await STRAVA_AUTH(new NextRequest("http://x/api/strava/auth?return=onboarding"))
    const to = res.headers.get("location") ?? ""
    expect(to).not.toContain("strava.com")
    expect(to).toContain("strava_error=closed")
  })

  it("the owner still goes to Strava", async () => {
    state.email = "owner@example.com"
    const res = await STRAVA_AUTH(new NextRequest("http://x/api/strava/auth"))
    expect(res.headers.get("location")).toContain("strava.com/oauth/authorize")
  })
})

describe("every place that offers it asks first", () => {
  it("onboarding, Settings and the Training page", () => {
    expect(strip("src/lib/onboarding.ts")).toMatch(/stravaOffered\(/)
    expect(strip("src/app/onboarding/OnboardingWizard.tsx")).toMatch(/connections\.stravaOffered && /)
    expect(strip("src/app/dashboard/settings/page.tsx")).toMatch(/stravaOffered\(userId\)/)
    expect(strip("src/app/api/strava/activities/route.ts")).toMatch(/stravaOffered\(/)
    expect(strip("src/app/dashboard/strava/page.tsx")).toMatch(/!connected && offered/)
    expect(strip("src/app/api/strava/callback/route.ts")).toMatch(/strava_ever_connected/)
  })
})
