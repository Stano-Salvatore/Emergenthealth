import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readdirSync, readFileSync, statSync } from "fs"
import { join } from "path"
import { isHomeOwner } from "@/lib/home-owner"

// The eWeLink, Tuya, EWPE (air conditioner) and Rowenta integrations log in
// with credentials from the deployment's environment — the owner's accounts,
// the owner's devices. /api/home used to check only that *someone* was signed
// in, so any Google account could list the owner's device ids and then switch
// the owner's AC on with a POST. Those branches now belong to the owner alone.

const ENV_KEYS = ["FEEDBACK_NOTIFY_EMAIL", "OWNER_EMAIL", "NEXT_PUBLIC_ENABLED_FEATURES"] as const

describe("isHomeOwner", () => {
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k] }
  })
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]
    }
  })

  it("is the owner, with smart home switched on", () => {
    process.env.FEEDBACK_NOTIFY_EMAIL = "owner@example.com"
    process.env.NEXT_PUBLIC_ENABLED_FEATURES = "smarthome"
    expect(isHomeOwner("owner@example.com")).toBe(true)
  })

  it("ignores case and stray spaces — Google returns the address its own way", () => {
    process.env.FEEDBACK_NOTIFY_EMAIL = " Owner@Example.com "
    process.env.NEXT_PUBLIC_ENABLED_FEATURES = "smarthome"
    expect(isHomeOwner("owner@example.com")).toBe(true)
  })

  it("is nobody else", () => {
    process.env.FEEDBACK_NOTIFY_EMAIL = "owner@example.com"
    process.env.NEXT_PUBLIC_ENABLED_FEATURES = "smarthome"
    expect(isHomeOwner("stranger@example.com")).toBe(false)
    expect(isHomeOwner(null)).toBe(false)
    expect(isHomeOwner(undefined)).toBe(false)
    expect(isHomeOwner("")).toBe(false)
  })

  it("fails closed when no owner is configured", () => {
    process.env.NEXT_PUBLIC_ENABLED_FEATURES = "smarthome"
    expect(isHomeOwner("owner@example.com")).toBe(false)
    expect(isHomeOwner("")).toBe(false)
  })

  it("falls back to OWNER_EMAIL", () => {
    process.env.OWNER_EMAIL = "owner@example.com"
    process.env.NEXT_PUBLIC_ENABLED_FEATURES = "smarthome"
    expect(isHomeOwner("owner@example.com")).toBe(true)
  })

  it("is closed while smart home is held back, even for the owner", () => {
    process.env.FEEDBACK_NOTIFY_EMAIL = "owner@example.com"
    expect(isHomeOwner("owner@example.com")).toBe(false)
  })
})

// Guard: any API route that can reach the owner's smart-home credentials must
// run the owner check. A new route that imports the eWeLink client without it
// would reopen the same door.
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []
  })
}

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

const OWNER_CREDENTIAL = /EWELINK_|TUYA_|EWPE_|BRIDGE_URL|@\/lib\/(ewelink|tuya|ewpe-smart)["']/

describe("routes reaching the owner's smart-home accounts", () => {
  const routes = walk("src/app/api").filter(f => OWNER_CREDENTIAL.test(stripComments(readFileSync(f, "utf8"))))

  it("finds /api/home among them", () => {
    expect(routes).toContain(join("src/app/api/home/route.ts"))
  })

  for (const file of routes) {
    it(`${file} runs the owner check`, () => {
      expect(stripComments(readFileSync(file, "utf8"))).toMatch(/isHomeOwner\(session\.user\.email\)/)
    })
  }
})
