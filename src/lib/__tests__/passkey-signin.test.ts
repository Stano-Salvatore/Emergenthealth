import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"

// "Sign in with passkey" could never succeed, for two reasons in a row.
//
// The login challenge was stored as a UserPreference row under a made-up
// userId ("passkey_auth_<uuid>"). UserPreference has a foreign key to User, so
// the insert failed every time — and the failure was swallowed, so the page
// got a challenge that was never saved and answered "Challenge expired" after
// the fingerprint prompt, every time.
//
// Had the challenge survived, the session cookie was set as
// "authjs.session-token". On HTTPS Auth.js reads "__Secure-authjs.session-token",
// so the fresh session was invisible and /dashboard bounced back to /signin.

const src = readFileSync("src/app/api/passkey/authenticate/route.ts", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ")

describe("passkey sign-in", () => {
  it("stores the challenge where no foreign key can refuse it", () => {
    expect(src).not.toContain("userPreference")
    expect(src).toMatch(/verificationToken\.create\(/)
    expect(src).toMatch(/identifier:\s*`passkey-auth:\$\{tempToken\}`/)
  })

  it("does not swallow a failed challenge write", () => {
    expect(src).not.toMatch(/\.catch\(\(\)\s*=>\s*\{\s*\}\)/)
  })

  it("only honours an unexpired challenge, and only once", () => {
    expect(src).toMatch(/expires:\s*\{\s*gt:\s*new Date\(\)\s*\}/)
    expect(src).toMatch(/verificationToken\.deleteMany\(/)
  })

  it("names the session cookie the way Auth.js reads it on HTTPS", () => {
    expect(src).toContain('"__Secure-authjs.session-token"')
    expect(src).toMatch(/protocol === "https:"/)
  })

  it("does not echo verifier internals back to the caller", () => {
    expect(src).not.toMatch(/String\(err\)/)
  })
})
