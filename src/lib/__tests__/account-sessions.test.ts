import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { sessionViews, currentSessionToken } from "@/lib/account-sessions"

// A phished mobile-bridge link, a lost phone, a shared computer: a session
// stayed valid for up to 30 days and the only way to end one was deleting
// rows in the database by hand. Settings now lists them and ends the others.

const now = new Date("2026-09-30T12:00:00Z")
const row = (id: string, token: string, created: string, updated: string, expires: string) => ({
  id, sessionToken: token, createdAt: new Date(created), updatedAt: new Date(updated), expires: new Date(expires),
})

describe("sessionViews", () => {
  const rows = [
    row("a", "tok-a", "2026-09-01T08:00:00Z", "2026-09-20T08:00:00Z", "2026-10-20T08:00:00Z"),
    row("b", "tok-b", "2026-09-25T08:00:00Z", "2026-09-30T07:00:00Z", "2026-10-30T07:00:00Z"),
    row("c", "tok-c", "2026-08-01T08:00:00Z", "2026-08-02T08:00:00Z", "2026-09-01T08:00:00Z"),
  ]

  it("marks this device, puts it first, then the most recently active", () => {
    const v = sessionViews(rows, "tok-a", now)
    expect(v.map(s => [s.id, s.current])).toEqual([["a", true], ["b", false]])
  })

  it("leaves out sessions that have already expired", () => {
    expect(sessionViews(rows, "tok-a", now).some(s => s.id === "c")).toBe(false)
  })

  it("never hands a session token to the browser", () => {
    const json = JSON.stringify(sessionViews(rows, "tok-a", now))
    expect(json).not.toMatch(/tok-/)
  })

  it("marks nothing current when the request carries no known token", () => {
    expect(sessionViews(rows, undefined, now).every(s => !s.current)).toBe(true)
  })
})

describe("currentSessionToken", () => {
  it("reads either cookie name Auth.js uses", () => {
    const jar = (name: string) => ({ get: (n: string) => (n === name ? { value: "t1" } : undefined) })
    expect(currentSessionToken(jar("__Secure-authjs.session-token"))).toBe("t1")
    expect(currentSessionToken(jar("authjs.session-token"))).toBe("t1")
    expect(currentSessionToken(jar("other"))).toBeUndefined()
  })
})

describe("the sessions route", () => {
  const src = readFileSync("src/app/api/account/sessions/route.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("only ever touches the signed-in user's own sessions, and never the current one", () => {
    expect(src).toMatch(/deleteMany\(\{\s*where:\s*\{[^}]*userId/)
    expect(src).toMatch(/sessionToken:\s*\{\s*not:\s*current\s*\}/)
  })

  it("refuses to sign out 'the others' when it cannot tell which one is this device", () => {
    expect(src).toMatch(/if \(!current\)/)
  })
})
