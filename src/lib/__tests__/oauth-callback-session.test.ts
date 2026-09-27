import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { callbackDecision, maskEmail, confirmConnectPage } from "@/lib/oauth-callback"

// The Oura and Strava callbacks took the account to save tokens to from the
// signed `state`, and nothing else. State proves *we* issued the link, not
// that the person approving it owns the account inside. So an attacker could
// start a connect on their own account, stop at Oura's approval URL, and send
// it to the owner: the owner approves, and the owner's ring data syncs into
// the attacker's dashboard from then on.
//
// The callback now checks the browser's own session. The same person is
// connected straight away; a different signed-in person is refused. With no
// session — the Android app finishes OAuth in the system browser, which may
// hold none — nothing is exchanged until the person has seen which account
// the connection is for, and confirmed it.

describe("callbackDecision", () => {
  it("exchanges when the browser's session is the account in state", () => {
    expect(callbackDecision("u1", "u1")).toBe("exchange")
  })
  it("refuses when a different person is signed in", () => {
    expect(callbackDecision("victim", "attacker")).toBe("mismatch")
  })
  it("asks first when nobody is signed in in this browser", () => {
    expect(callbackDecision(null, "u1")).toBe("confirm")
    expect(callbackDecision(undefined, "u1")).toBe("confirm")
    expect(callbackDecision("", "u1")).toBe("confirm")
  })
})

describe("maskEmail", () => {
  it("shows enough to recognise, not enough to harvest", () => {
    expect(maskEmail("stanislav@gmail.com")).toBe("st•••@gmail.com")
    expect(maskEmail("a@b.co")).toBe("a•••@b.co")
  })
  it("says so when there is no address", () => {
    expect(maskEmail(null)).toBe("an account with no email address")
    expect(maskEmail("not-an-email")).toBe("an account with no email address")
  })
})

describe("confirmConnectPage", () => {
  const page = confirmConnectPage({
    provider: "Oura",
    account: "st•••@gmail.com",
    action: "/api/oura/callback",
    code: `"><script>alert(1)</script>`,
    state: "s&t<a>te",
  })

  it("names the account the connection will be saved to", () => {
    expect(page).toContain("st•••@gmail.com")
  })

  it("posts the code back rather than exchanging it on the GET", () => {
    expect(page).toMatch(/<form method="post" action="\/api\/oura\/callback">/)
  })

  it("escapes everything that came in on the query string", () => {
    expect(page).not.toContain("<script>alert(1)</script>")
    expect(page).toContain("&quot;&gt;&lt;script&gt;")
    expect(page).toContain("s&amp;t&lt;a&gt;te")
  })
})

const code = (file: string) =>
  readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

for (const provider of ["oura", "strava"]) {
  describe(`/api/${provider}/callback`, () => {
    const src = code(`src/app/api/${provider}/callback/route.ts`)

    it("checks the browser's session before any token exchange", () => {
      const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"))
      expect(get).toMatch(/callbackDecision\(session\?\.user\?\.id, userId\)/)
      expect(get).not.toMatch(/fetch\(/)
    })

    it("re-checks on the confirming POST", () => {
      const post = src.slice(src.indexOf("export async function POST"))
      expect(post).toMatch(/callbackDecision\(session\?\.user\?\.id, userId\) === "mismatch"/)
    })
  })
}
