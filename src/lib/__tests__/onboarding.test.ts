import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { oauthReturnPath } from "@/lib/oauth-callback"
import { onboardingSteps } from "@/lib/onboarding-steps"

const strip = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("a new account reaches onboarding", () => {
  it("the dashboard's redirect is not swallowed by a try/catch — redirect() works by throwing", () => {
    const layout = strip("src/app/dashboard/layout.tsx")
    expect(layout).toMatch(/if \(await needsOnboarding\([^)]*\)\) redirect\("\/onboarding"\)/)
    expect(layout).not.toMatch(/try\s*\{[^}]*redirect\("\/onboarding"\)/)
  })

  it("Skip records the skip, or the dashboard would send them straight back", () => {
    const page = strip("src/app/onboarding/page.tsx")
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
  const page = strip("src/app/onboarding/page.tsx")
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
