import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { resolveAuthRedirect } from "@/lib/auth-redirect"

// Auth.js asks the redirect callback where to send the browser after sign-in
// and sign-out, passing whatever callbackUrl the link carried. The callback
// accepted any URL that *started with* the site's address, and
// "https://emergenthealth.vercel.app.attacker.tld/signin" does. One click on
// the real site's "Sign out?" button sent the owner to a lookalike sign-in
// page asking for the username and password. The check is now by origin.

const BASE = "https://emergenthealth.vercel.app"

describe("resolveAuthRedirect", () => {
  it("rejects a lookalike host that merely begins with our address", () => {
    expect(resolveAuthRedirect("https://emergenthealth.vercel.app.attacker.tld/signin", BASE)).toBe(BASE)
    expect(resolveAuthRedirect("https://emergenthealth.vercel.app@attacker.tld/", BASE)).toBe(BASE)
  })

  it("rejects other sites outright", () => {
    expect(resolveAuthRedirect("https://attacker.tld/", BASE)).toBe(BASE)
    expect(resolveAuthRedirect("http://emergenthealth.vercel.app/dashboard", BASE)).toBe(BASE)
  })

  it("keeps protocol-relative and backslash tricks on our origin", () => {
    expect(new URL(resolveAuthRedirect("//attacker.tld/x", BASE)).origin).toBe(BASE)
    expect(new URL(resolveAuthRedirect("/\\attacker.tld/x", BASE)).origin).toBe(BASE)
  })

  it("allows our own absolute URLs and paths", () => {
    expect(resolveAuthRedirect(`${BASE}/dashboard?x=1`, BASE)).toBe(`${BASE}/dashboard?x=1`)
    expect(resolveAuthRedirect("/dashboard/settings", BASE)).toBe(`${BASE}/dashboard/settings`)
  })

  it("falls back to home for garbage", () => {
    expect(resolveAuthRedirect("http://[::1", BASE)).toBe(BASE)
  })
})

describe("the Auth.js redirect callback", () => {
  const src = readFileSync("src/auth.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")

  it("decides by origin, never by string prefix", () => {
    expect(src).not.toMatch(/url\.startsWith\(baseUrl\)/)
    expect(src).toContain("resolveAuthRedirect(url, baseUrl)")
  })
})
