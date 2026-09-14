import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { describeFetchFailure } from "@/lib/fetch-error"

// Eleven handlers across six screens said "Network error" for anything that
// threw, with the error itself discarded unread — `catch {`, no binding. None
// of them could have known it was the network.
//
// In the Strava and Oura sync handlers the misdiagnosis was reachable and
// wrong in the ordinary case: `await res.json()` sits inside the try, so a 500
// returning an HTML crash page throws a SyntaxError, lands in the catch, and
// tells the user to check their connection. Their connection was fine. The
// server fell over and the one person who could have reported it was sent to
// look at their router.

describe("it says which thing failed", () => {
  it("calls a network failure a network failure", () => {
    // fetch() rejects with TypeError only at the network layer. The one case
    // where the old string happened to be right.
    const said = describeFetchFailure(new TypeError("Failed to fetch"), false)
    expect(said).toContain("Couldn't reach the server")
    expect(said, "every one of these ends in what to do next").toMatch(/try again/i)
  })

  it("does not blame the network when the server crashed", () => {
    // The bug, stated as a test: res.json() on an HTML error page.
    const said = describeFetchFailure(new SyntaxError("Unexpected token '<'"), false)
    expect(said, "this is what was being called a network error").not.toMatch(/connection|offline|reach/i)
    expect(said).toContain("errored")
  })

  it("says plainly that it doesn't know, rather than guessing", () => {
    // The honest default. "Honest UI over reassuring UI" cuts both ways: a
    // confident wrong cause is worse than an admitted unknown.
    const said = describeFetchFailure(new Error("something odd"), false)
    expect(said).toBe("That didn't go through. Try again in a minute.")
    expect(said).not.toMatch(/network|connection|server/i)
  })

  it("leads with being offline, which outranks any of it", () => {
    // Knowing the browser is offline beats inspecting the throw — whatever it
    // was, the connection is the thing to fix.
    expect(describeFetchFailure(new SyntaxError("x"), true)).toContain("offline")
    expect(describeFetchFailure(new TypeError("x"), true)).toContain("offline")
  })

  it("never asserts a cause it cannot have established", () => {
    for (const err of [new Error("x"), new SyntaxError("x"), {}, null, "a string"]) {
      const said = describeFetchFailure(err, false)
      expect(said, `"${said}" claims the network for ${String(err)}`)
        .not.toContain("Check your connection")
    }
  })
})

describe("no screen still guesses on its own", () => {
  const SCREENS = [
    "src/components/settings/LastfmManager.tsx",
    "src/components/settings/RescuetimeManager.tsx",
    "src/components/settings/OuraManager.tsx",
    "src/components/settings/GitHubManager.tsx",
    "src/components/settings/StravaManager.tsx",
    "src/components/health/OuraSyncButton.tsx",
  ]

  it("the bare string is gone from all of them", () => {
    for (const f of SCREENS) {
      expect(readFileSync(f, "utf8"), `${f} still asserts the network`)
        .not.toContain('"Network error"')
    }
  })

  it("and each one actually reads the error it caught", () => {
    // `catch {` with no binding is the shape that made the old string
    // inevitable: nothing to inspect, so something had to be invented.
    for (const f of SCREENS) {
      const s = readFileSync(f, "utf8")
      expect(s, `${f} should hand the throw to describeFetchFailure`)
        .toContain("describeFetchFailure(e)")
      expect(s, `${f} has a catch that discards the error next to one that reads it`)
        .not.toMatch(/\}\s*catch\s*\{[^}]*describeFetchFailure/)
    }
  })
})

describe("a failed sync does not report a partial success", () => {
  // Found by staging a 500 in a browser, not by reading the code. The Oura
  // panel carried one field, `tagsError`, for two unrelated outcomes: "the
  // health data arrived and only the tags failed" and "nothing arrived at
  // all". A server error therefore rendered as
  //
  //   Health data synced (0 days) but tags failed: …
  //
  // over advice to reconnect Oura for the `tag` permission — a success that
  // never happened, and a remedy that could not have fixed it.
  const oura = readFileSync("src/components/settings/OuraManager.tsx", "utf8")

  it("models the two outcomes separately", () => {
    expect(oura).toContain("{ ok: false; error: string }")
    expect(oura, "a total failure must not carry a synced count at all")
      .not.toMatch(/setSyncResult\(\{\s*synced:\s*0,\s*tagsSynced:\s*0/)
  })

  it("says nothing synced when nothing synced", () => {
    expect(oura).toContain("Sync didn&apos;t run:")
  })

  it("keeps the tag-permission advice for the case it actually fixes", () => {
    // The partial outcome is real and its remedy is right — this must not be
    // "fixed" by deleting the useful half.
    expect(oura).toContain("Health data synced ({syncResult.synced} days)")
    expect(oura).toContain("permission is granted")
    expect(oura, "the advice belongs to the partial branch, behind ok")
      .toMatch(/!syncResult\.ok \?[\s\S]*?syncResult\.tagsError \?/)
  })
})
