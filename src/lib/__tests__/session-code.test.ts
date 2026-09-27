import { describe, it, expect, beforeAll } from "vitest"
import { createHmac } from "crypto"
import { readFileSync } from "fs"
import { signSessionCode, verifySessionCode, isAuthKey, mayRedeemFrom } from "@/lib/session-code"

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

// A mobile auth key is chosen by whoever starts the flow. An attacker could
// mint one, send the owner a /mobile-signin?auth_key=… link, and — once the
// owner clicked through Google's consent screen — redeem the stored code from
// their own machine, receiving the owner's 30-day session cookie. The code now
// carries the address of the browser that finished sign-in, and only a redeem
// from that same address is honoured: the Custom Tab and the app's WebView on
// one phone share it, a stranger elsewhere does not.
describe("redeeming a session code", () => {
  const fresh = (i?: string) => verifySessionCode(signSessionCode({ t: "tok", n: "n", x: Date.now() + 60_000, ...(i !== undefined && { i }) }))!

  it("carries the finishing browser's address through the signature", () => {
    expect(fresh("203.0.113.7").i).toBe("203.0.113.7")
  })

  it("is honoured from the same address", () => {
    expect(mayRedeemFrom(fresh("203.0.113.7"), "203.0.113.7")).toBe(true)
  })

  it("is refused from any other address", () => {
    expect(mayRedeemFrom(fresh("203.0.113.7"), "198.51.100.9")).toBe(false)
  })

  // One phone is not always one address. Android gives each connection a
  // rotating IPv6 privacy address inside the same /64, and the Custom Tab and
  // the WebView can leave over different families — an exact match locked the
  // owner out of signing in on their own phone.
  it("is honoured from another address in the same IPv6 /64", () => {
    expect(mayRedeemFrom(fresh("2a02:8308:a001:4c00:1d3e:9b2:77a1:c3"), "2a02:8308:a001:4c00:8f0:41aa:e2:19")).toBe(true)
    expect(mayRedeemFrom(fresh("2a02:8308:a001:4c00::1"), "2a02:8308:a001:4c01::1")).toBe(false)
  })

  it("is honoured when the two requests left over different families", () => {
    expect(mayRedeemFrom(fresh("2a02:8308:a001:4c00::1"), "203.0.113.7")).toBe(true)
    expect(mayRedeemFrom(fresh("203.0.113.7"), "2a02:8308:a001:4c00::1")).toBe(true)
  })

  it("is refused when either address is unknown", () => {
    expect(mayRedeemFrom(fresh("unknown"), "unknown")).toBe(false)
  })

  it("is refused when the code names no address at all", () => {
    expect(mayRedeemFrom(fresh(), "203.0.113.7")).toBe(false)
  })

  it("rejects a code whose address field is not a string", () => {
    const payload = Buffer.from(JSON.stringify({ t: "tok", n: "n", x: Date.now() + 60_000, i: 7 })).toString("base64url")
    const sig = createHmac("sha256", process.env.AUTH_SECRET!).update(payload).digest("base64url")
    expect(verifySessionCode(`${payload}~${sig}`)).toBeNull()
  })
})

const code = (file: string) =>
  readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

describe("the mobile sign-in routes", () => {
  it("the bridge seals the finishing browser's address into the code", () => {
    expect(code("src/app/api/mobile-auth-bridge/route.ts")).toMatch(/signSessionCode\(\{[^}]*\bi:\s*clientIp\(request\)/)
  })

  it("set-cookie checks the address before it consumes the row or sets a cookie", () => {
    const src = code("src/app/api/mobile-set-cookie/route.ts")
    const check = src.indexOf("mayRedeemFrom(")
    expect(check).toBeGreaterThan(-1)
    expect(check).toBeLessThan(src.lastIndexOf("deleteMany"))
    expect(check).toBeLessThan(src.indexOf("Set-Cookie"))
    // Refused to /signin with a reason, never a Set-Cookie: the WebView has no address bar to escape a dead end.
    expect(src).toMatch(/if \(!mayRedeemFrom\(data, ip\)\) \{\s*return Response\.redirect\(new URL\("\/signin\?error=MobileOtherNetwork"/)
    expect(readFileSync("src/app/signin/page.tsx", "utf8")).toMatch(/MobileOtherNetwork:\s*"/)
  })

  it("poll and set-cookie are limited per address", () => {
    expect(code("src/app/api/mobile-set-cookie/route.ts")).toMatch(/const ip = clientIp\(request\)[\s\S]*checkRateLimit\(ip,/)
    expect(code("src/app/api/mobile-auth-poll/route.ts")).toMatch(/checkRateLimit\(clientIp\(request\)/)
  })
})
