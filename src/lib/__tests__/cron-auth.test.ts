import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readdirSync, readFileSync } from "fs"
import { requireCronSecret, headerSecretMatches } from "@/lib/cron-auth"

const req = (auth?: string) => new Request("https://x/api/cron/x", { headers: auth ? { authorization: auth } : {} })

describe("requireCronSecret", () => {
  const saved = process.env.CRON_SECRET
  beforeEach(() => { process.env.CRON_SECRET = "s3cret" })
  afterEach(() => { if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved })

  it("lets the scheduler through", () => {
    expect(requireCronSecret(req("Bearer s3cret"))).toBeNull()
  })

  it("rejects a wrong or missing bearer", () => {
    expect(requireCronSecret(req("Bearer nope"))?.status).toBe(401)
    expect(requireCronSecret(req())?.status).toBe(401)
    expect(requireCronSecret(req("Bearer s3cre"))?.status).toBe(401)
    expect(requireCronSecret(req("Bearer s3cretX"))?.status).toBe(401)
  })

  it("fails CLOSED when the secret is not configured", () => {
    delete process.env.CRON_SECRET
    // This is the whole reason the helper exists: the old inline check let
    // every cron become public the moment the variable went missing.
    expect(requireCronSecret(req("Bearer anything"))?.status).toBe(503)
    expect(requireCronSecret(req())?.status).toBe(503)
  })
})

describe("headerSecretMatches", () => {
  it("is false for an unset secret, even with a matching-looking header", () => {
    expect(headerSecretMatches("x", undefined)).toBe(false)
    expect(headerSecretMatches("", "x")).toBe(false)
    expect(headerSecretMatches(null, "x")).toBe(false)
  })
  it("compares exactly", () => {
    expect(headerSecretMatches("abc", "abc")).toBe(true)
    expect(headerSecretMatches("abd", "abc")).toBe(false)
    expect(headerSecretMatches("abcd", "abc")).toBe(false)
  })
})

// Guard: every scheduled route goes through the shared gate. A new cron that
// pastes the old `if (secret && …)` shape would reintroduce the fail-open.
describe("every cron route uses requireCronSecret", () => {
  const dir = "src/app/api/cron"
  const routes = readdirSync(dir).map(name => `${dir}/${name}/route.ts`)

  it("finds the cron routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(18)
  })

  for (const file of routes) {
    it(`${file} calls requireCronSecret and never reads CRON_SECRET itself`, () => {
      const src = readFileSync(file, "utf8")
      expect(src).toContain("requireCronSecret(req)")
      expect(src).not.toContain("process.env.CRON_SECRET")
    })
  }
})
