import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { ouraErrorDetail } from "@/lib/oura"
import { whyBlank } from "@/lib/sync-status"

// The first real sync after the blank-column work shipped rendered this, on a
// phone, to a user:
//
//   No cardio capacity, vascular age, pulse wave velocity or resilience —
//   Oura refused the request: Oura API error: 401 Unauthorized.
//
// Two faults in one line. "Oura" twice, because the screen introduces the
// provider and the thrown error named it again. And "Oura API error:" is an
// internal throw's prefix, which had never been read by anyone until the day a
// refusal was first put on a screen instead of into a log.
//
// It also says nothing useful. A bare 401 cannot separate "this token
// expired", "this token was never granted that scope" and "your plan does not
// include this endpoint" — three problems, three different fixes, and the
// response body Oura sends explaining which was being discarded.

const oura = readFileSync("src/lib/oura.ts", "utf8")
/** Comments may name the mistake they prevent; the code may not. */
const code = oura.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

describe("the sentence that shipped wrong", () => {
  it("no longer names Oura twice", () => {
    // Rendered end to end: the thrown message's shape, through the sentence
    // the health page actually builds from it.
    const thrown = "401 Unauthorized"
    const rendered = whyBlank("Oura", { state: "failed", reason: thrown })!
    expect(rendered).toBe("Oura refused the request: 401 Unauthorized")
    expect(rendered.match(/Oura/g), `"${rendered}" says Oura more than once`).toHaveLength(1)
  })

  it("never leaks an internal throw prefix onto a screen", () => {
    expect(code, '"Oura API error:" reached a user\'s phone once already')
      .not.toContain("Oura API error")
  })

  it("keeps the status code, which two callers still read", () => {
    // oura-sync decides "denied" from /\b(401|403)\b/ on this text to phrase
    // the tag-scope message. Dropping the number to tidy the sentence would
    // silently turn that branch off.
    expect(code).toContain("${response.status} ${response.statusText}")
  })

  it("never carries the connector the screen already spends", () => {
    // The second render caught the same fault one layer down: the thrown
    // message joined status and detail with an em dash, and the page puts one
    // in front of the whole phrase. "No resilience — Oura refused the request:
    // 401 Unauthorized — Token is not authorized access stress scope."
    expect(code, "an em dash here lands beside the one the screen writes")
      .not.toContain("` — ${detail}`")
    expect(code).toContain("`${detail} (${status})`")
  })
})

describe("what Oura said, past the status line", () => {
  it("quotes the explanation Oura sends", () => {
    expect(ouraErrorDetail('{"detail":"Insufficient scope"}')).toBe("Insufficient scope")
  })

  it("accepts the shapes its OAuth endpoints use", () => {
    expect(ouraErrorDetail('{"error_description":"Token is expired"}')).toBe("Token is expired")
    expect(ouraErrorDetail('{"error":"invalid_grant"}')).toBe("invalid_grant")
    expect(ouraErrorDetail('{"message":"Subscription required"}')).toBe("Subscription required")
  })

  it("says nothing rather than something useless", () => {
    // An empty body, a body with no explanation in it, and a gateway's HTML
    // error page. The last one is the trap: a page of markup pasted into a
    // health screen is worse than the bare status line it replaced.
    expect(ouraErrorDetail("")).toBeNull()
    expect(ouraErrorDetail("   ")).toBeNull()
    expect(ouraErrorDetail('{"data":[]}')).toBeNull()
    expect(ouraErrorDetail("<html><body>502 Bad Gateway</body></html>")).toBeNull()
  })

  it("takes a plain-text body as it comes", () => {
    expect(ouraErrorDetail("Unauthorized access token")).toBe("Unauthorized access token")
  })

  it("clips a long one to something a stat box can hold", () => {
    const long = ouraErrorDetail(JSON.stringify({ detail: "word ".repeat(80) }))!
    expect(long.length).toBeLessThanOrEqual(100)
    expect(long.endsWith("…")).toBe(true)
  })
})

describe("nine requests, one refresh", () => {
  // The sync fires nine endpoints through one Promise.allSettled. On an
  // expired token all nine 401 together, and the old code had each of them
  // independently read the same refresh token and POST it. Oura rotates
  // refresh tokens — this file stores the rotated one — so the first POST
  // spends it and the rest present a token that is already gone; reuse of a
  // rotated token is also the signature of a stolen one, which makes revoking
  // the whole family the correct response to it.
  //
  // Whether that is what produced the 401s on three endpoints is not settled
  // here. It is a bug either way, and these keep the funnel in place.

  it("refreshes through the shared gate, not directly", () => {
    const direct = [...code.matchAll(/\brefreshAccessToken\(/g)]
    // Its own definition, the one call inside freshAccessToken, and nothing
    // else. A fourth is a request refreshing on its own again.
    expect(direct.length,
      "every refresh must go through freshAccessToken, which serialises them per user")
      .toBe(2)
    expect(code).toContain("freshAccessToken(userId, accessToken)")
  })

  it("claims the slot without awaiting first", () => {
    // The whole point, and subtler than it looks. The database read lives
    // inside an async IIFE, so it appears *above* `refreshInFlight.set` in the
    // source while running after it — the IIFE hands back a promise at its
    // first await and the `set` follows in the same synchronous block, where
    // no other caller can interleave.
    //
    // Source order is therefore the wrong thing to assert; the first draft of
    // this test asserted it and failed against correct code. What actually
    // has to hold is that `freshAccessToken` itself cannot await before
    // claiming the slot — which is exactly what not being `async` guarantees.
    const gate = code.slice(code.indexOf("function freshAccessToken"))
    const body = gate.slice(0, gate.indexOf("\nasync function refreshAccessToken"))

    expect(code, "an async gate can await before claiming the slot, and two callers get through")
      .toContain("\nfunction freshAccessToken(")
    expect(body).toContain("refreshInFlight.set")
    // Every await belongs to the IIFE, never to the gate around it.
    expect(body.slice(0, body.indexOf("const pending")))
      .not.toContain("await")
  })

  it("uses a token someone else already fetched instead of spending another", () => {
    // A request that 401s, then arrives after another has finished refreshing,
    // finds a stored token that is not the one it failed with. That is the
    // answer — refreshing again would spend the newly rotated token to learn
    // the same thing.
    expect(code).toContain("stored.accessToken !== failedWith")
  })
})
