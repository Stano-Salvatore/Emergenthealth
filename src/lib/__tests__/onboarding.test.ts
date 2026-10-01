import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { oauthReturnPath } from "@/lib/oauth-callback"
import { onboardingSteps } from "@/lib/onboarding-steps"
import { EXAMPLE_PATTERN } from "@/lib/onboarding-example"
import { CONFIDENT_N } from "@/lib/pattern-rules"

const strip = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("a new account reaches onboarding", () => {
  it("the dashboard's redirect is not swallowed by a try/catch — redirect() works by throwing", () => {
    const layout = strip("src/app/dashboard/layout.tsx")
    expect(layout).toMatch(/if \(await needsOnboarding\([^)]*\)\) redirect\("\/onboarding"\)/)
    expect(layout).not.toMatch(/try\s*\{[^}]*redirect\("\/onboarding"\)/)
  })

  it("Skip records the skip, or the dashboard would send them straight back", () => {
    const page = strip("src/app/onboarding/OnboardingWizard.tsx")
    expect(page).toMatch(/skipped: true/)
    expect(page).not.toMatch(/<Link href="\/dashboard">Skip setup/)
  })
})

describe("the steps", () => {
  it("asks about the cycle unless they said male", () => {
    expect(onboardingSteps({ sex: "female" })).toContain("cycle")
    expect(onboardingSteps({ sex: null })).toContain("cycle")
    expect(onboardingSteps({ sex: "male" })).not.toContain("cycle")
  })

  it("starts with the welcome and ends with done", () => {
    const s = onboardingSteps({ sex: null })
    expect(s[0]).toBe("welcome")
    expect(s.at(-1)).toBe("done")
    expect(s).toEqual(expect.arrayContaining(["about", "connect", "notify"]))
  })
})

describe("connecting from the wizard comes back to the wizard", () => {
  it("lands on the connect step when it started there, Settings otherwise", () => {
    expect(oauthReturnPath("onboarding", "oura_connected=1")).toBe("/onboarding?step=connect&oura_connected=1")
    expect(oauthReturnPath(undefined, "oura_connected=1")).toBe("/dashboard/settings?oura_connected=1")
    expect(oauthReturnPath("https://evil.example", "x=1")).toBe("/dashboard/settings?x=1")
  })

  it.each(["oura", "strava"])("%s: the start remembers, the callback returns", provider => {
    expect(strip(`src/app/api/${provider}/auth/route.ts`)).toMatch(/OAUTH_RETURN_COOKIE/)
    expect(strip(`src/app/api/${provider}/callback/route.ts`)).toMatch(/oauthReturnPath\(/)
  })
})

describe("the wizard only promises what the app does", () => {
  const page = strip("src/app/onboarding/OnboardingWizard.tsx")
  it("no step that saves nothing, no buttons that are only text", () => {
    expect(page).not.toMatch(/We&apos;ll prioritize|We'll prioritize/)
    expect(page).not.toMatch(/Connect in Settings →/)
    expect(page).not.toMatch(/Streak protection/)
  })

  it("what it asks is saved where the app reads it", () => {
    expect(page).toMatch(/\/api\/goals/)
    expect(page).toMatch(/\/api\/cycle\/settings/)
    expect(page).toMatch(/\/api\/oura\/auth\?return=onboarding/)
  })
})

describe("how patterns work comes before anything is asked", () => {
  it("is the step right after the welcome", () => {
    expect(onboardingSteps({ sex: null })[1]).toBe("patterns")
    expect(onboardingSteps({ sex: "male" })[1]).toBe("patterns")
  })

  it("the example says it is one, and is drawn with the real card's parts", () => {
    const step = strip("src/components/onboarding/PatternsStep.tsx")
    expect(step).toMatch(/Example/)
    expect(step).toMatch(/from "@\/components\/insights\/InsightParts"/)
    expect(strip("src/app/dashboard/insights/page.tsx")).toMatch(/from "@\/components\/insights\/InsightParts"/)
  })

  it("the example obeys the rules it explains", () => {
    const { high, low, delta, finding } = EXAMPLE_PATTERN
    // compareGroups' arithmetic: the change against the other side, to one decimal.
    expect(delta).toBe(Math.round(((high.avg - low.avg) / Math.abs(low.avg)) * 1000) / 10)
    // A card shown as Solid with a thin side would teach the wrong thing.
    expect(EXAMPLE_PATTERN.tier).toBe("strong")
    expect(high.n).toBeGreaterThanOrEqual(CONFIDENT_N)
    expect(low.n).toBeGreaterThanOrEqual(CONFIDENT_N)
    expect(finding).toContain(String(high.avg))
    expect(finding).toContain(String(low.avg))
  })

  it("the timeline at the end is built from the engine's bars", () => {
    expect(strip("src/app/onboarding/OnboardingWizard.tsx")).toMatch(/EARLIEST_TEST_DAY/)
  })
})

describe("connections show only what is true", () => {
  it("Google Calendar reads as connected only for an account holding a Google grant", () => {
    expect(strip("src/app/onboarding/OnboardingWizard.tsx")).toMatch(/connections\.calendar/)
    expect(strip("src/lib/onboarding.ts")).toMatch(/provider: "google"/)
  })
})

describe("the wizard's buttons own the bottom of the screen", () => {
  it("the corner Privacy/Terms links stay out of it, and the steps asking personal things link the policy", () => {
    expect(strip("src/components/layout/LegalFooter.tsx")).toMatch(/"\/onboarding"/)
    expect(strip("src/app/onboarding/OnboardingWizard.tsx")).toMatch(/href="\/privacy"/)
  })
})

describe("Getting started follows the account, not the browser", () => {
  it("is timed from when the account was made", () => {
    // A first-seen stamp in localStorage hid the card on the very first visit
    // (the stamp was written after the check) and restarted the fortnight on
    // every new device.
    expect(strip("src/components/dashboard/QuickStart.tsx")).not.toMatch(/eh_first_seen/)
    expect(strip("src/app/dashboard/page.tsx")).toMatch(/accountAgeDays=/)
  })
})
