import { describe, it, expect, beforeAll } from "vitest"
import { signSessionCode, verifySessionCode, isAuthKey } from "@/lib/session-code"

beforeAll(() => { process.env.AUTH_SECRET = "test-secret-please-ignore" })

describe("session codes", () => {
  it("round-trips a fresh code", () => {
    const code = signSessionCode({ t: "tok", n: "authjs.session-token", x: Date.now() + 60_000 })
    expect(verifySessionCode(code)).toMatchObject({ t: "tok", n: "authjs.session-token" })
  })

  it("rejects a tampered payload, a tampered signature, and garbage", () => {
    const code = signSessionCode({ t: "tok", n: "n", x: Date.now() + 60_000 })
    const [payload, sig] = code.split("~")
    const forged = Buffer.from(JSON.stringify({ t: "other", n: "n", x: Date.now() + 60_000 })).toString("base64url")
    expect(verifySessionCode(`${forged}~${sig}`)).toBeNull()
    expect(verifySessionCode(`${payload}~${sig.slice(0, -2)}xx`)).toBeNull()
    expect(verifySessionCode("nonsense")).toBeNull()
    expect(verifySessionCode("")).toBeNull()
  })

  it("rejects an expired code even with a valid signature", () => {
    const code = signSessionCode({ t: "tok", n: "n", x: Date.now() - 1 })
    expect(verifySessionCode(code)).toBeNull()
  })
})

describe("isAuthKey", () => {
  it("accepts only the UUID shape the native app mints", () => {
    expect(isAuthKey("3b241101-e2bb-4255-8caf-4136c566a962")).toBe(true)
    expect(isAuthKey("3B241101-E2BB-4255-8CAF-4136C566A962")).toBe(true)
    expect(isAuthKey("</script><script>alert(1)</script>")).toBe(false)
    expect(isAuthKey("3b241101e2bb42558caf4136c566a962")).toBe(false)
    expect(isAuthKey("")).toBe(false)
    expect(isAuthKey(null)).toBe(false)
    expect(isAuthKey(undefined)).toBe(false)
  })
})
