import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { explainBlanks, listPhrase, scopeRemedy, whyBlank, type SyncRun } from "@/lib/sync-status"
import { ouraErrorDetail } from "@/lib/oura"

// Why a column is empty, kept where someone can read it.
//
// `cardiovascularAge`, `pulseWaveVelocity`, `vo2Max` and `resilienceLevel` all
// shipped with their mappers and all stayed null. The sync knew why — it knows
// the difference between a request Oura refused, a window Oura had nothing for,
// and rows that arrived and mapped to nothing — and it said so to
// `console.warn`, which on this deployment is readable for about an hour. The
// column is still empty a week later; the reason is not.
//
// So the outcomes are persisted and rendered. That is a chain of four links,
// each of which fails silently and returns the screen to a blank space with no
// explanation, which is exactly the state that was worth a week of guessing.

const src = (f: string) => readFileSync(f, "utf8")

describe("the reason outlives the log line", () => {
  it("routes every Oura endpoint through the recorder", () => {
    // The link that would break first. Adding a tenth endpoint and reading it
    // straight out of the settled array costs nothing today and leaves one
    // column with no answer forever.
    const sync = src("src/lib/oura-sync.ts")
    const fetched = [...sync.matchAll(/^\s+get[A-Z]\w*\(userId, startDate, endDate\),$/gm)]
    const recorded = [...sync.matchAll(/byDate\("([^"]+)"/g)].map(m => m[1])

    expect(fetched.length, "the allSettled array should still be found").toBeGreaterThan(5)
    expect(recorded.length,
      `${fetched.length} endpoints are fetched but only ${recorded.length} go through byDate — ` +
      "one of them will render as a blank with nothing to say about itself")
      .toBe(fetched.length)
    expect(new Set(recorded).size, "two endpoints sharing a name overwrite each other's outcome")
      .toBe(recorded.length)
  })

  it("returns them from the sync", () => {
    expect(src("src/lib/oura-sync.ts")).toContain("tagsError, endpoints }")
  })

  it("persists them", () => {
    // Dropped here and the cron writes a status line that knows nothing.
    expect(src("src/lib/sync-status-store.ts")).toContain("run.endpoints")
  })

  it("hands them to the recorder from the cron", () => {
    expect(src("src/app/api/cron/oura/route.ts")).toContain("endpoints: result.endpoints")
  })

  it("reads them back on the screen showing the blank", () => {
    const page = src("src/app/dashboard/health/page.tsx")
    expect(page).toContain("explainBlanks(")
    // The four figures this exists for. A box added to that group without a
    // line here is a blank that goes back to explaining nothing.
    for (const endpoint of ["vO2_max", "daily_cardiovascular_age", "daily_resilience"]) {
      expect(page, `${endpoint} has a figure on this page and no entry in the blanks list`)
        .toContain(endpoint)
    }
  })
})

describe("what it says", () => {
  it("does not call an empty window a fault", () => {
    // The commonest answer by far, and not a problem to be fixed. Oura
    // publishes these on its own cadence; a quiet week is a quiet week.
    const said = whyBlank("Oura", { state: "empty" })
    expect(said).toBe("Oura had nothing to send for this window")
    expect(said).not.toMatch(/error|fail|broken|problem/i)
  })

  it("quotes the refusal rather than paraphrasing it", () => {
    // A scope the token was never granted and a plan that doesn't include the
    // endpoint both land here, and the difference is in Oura's own words.
    //
    // Joined with a colon. The screen already spends a dash introducing this
    // phrase, and two dashes doing two jobs in one short line is a stumble.
    expect(whyBlank("Oura", { state: "failed", reason: "403 Forbidden" }))
      .toBe("Oura refused the request: 403 Forbidden")
  })

  it("says so when rows arrived and the figure still came out empty", () => {
    // The one case that points at us. Thirty days of documents and nothing to
    // show for them is what a misread key name looks like from outside.
    expect(whyBlank("Oura", { state: "ok", days: 30 }))
      .toBe("Oura sent 30 days of this, none of them this one")
    expect(whyBlank("Oura", { state: "ok", days: 1 })).toContain("1 day of this")
  })

  it("says nothing when nothing was recorded", () => {
    // Before the first sync after this ships there is no answer to give, and
    // inventing one is the failure this whole chain exists to stop.
    expect(whyBlank("Oura", undefined)).toBeNull()
    expect(explainBlanks("Oura", [{ label: "resilience", endpoint: "daily_resilience" }], undefined))
      .toEqual([])
  })
})

describe("four blanks with one cause between them", () => {
  const run = (endpoints: SyncRun["endpoints"]): SyncRun =>
    ({ at: "2026-09-11T09:00:00Z", ok: true, endpoints })

  it("says it once", () => {
    const out = explainBlanks("Oura", [
      { label: "vascular age", endpoint: "daily_cardiovascular_age" },
      { label: "pulse wave velocity", endpoint: "daily_cardiovascular_age" },
      { label: "resilience", endpoint: "daily_resilience" },
    ], run({
      daily_cardiovascular_age: { state: "empty" },
      daily_resilience: { state: "empty" },
    }))

    expect(out).toHaveLength(1)
    expect(out[0].labels).toEqual(["vascular age", "pulse wave velocity", "resilience"])
  })

  it("keeps two different causes apart", () => {
    const out = explainBlanks("Oura", [
      { label: "vascular age", endpoint: "daily_cardiovascular_age" },
      { label: "resilience", endpoint: "daily_resilience" },
    ], run({
      daily_cardiovascular_age: { state: "empty" },
      daily_resilience: { state: "failed", reason: "403 Forbidden" },
    }))

    expect(out).toHaveLength(2)
    expect(out.map(r => r.labels)).toEqual([["vascular age"], ["resilience"]])
  })

  it("drops the ones nothing was recorded about", () => {
    const out = explainBlanks("Oura", [
      { label: "vascular age", endpoint: "daily_cardiovascular_age" },
      { label: "cardio capacity", endpoint: "vO2_max" },
    ], run({ daily_cardiovascular_age: { state: "empty" } }))

    expect(out).toHaveLength(1)
    expect(out[0].labels).toEqual(["vascular age"])
  })
})

describe("listPhrase", () => {
  it("reads aloud", () => {
    expect(listPhrase([])).toBe("")
    expect(listPhrase(["resilience"])).toBe("resilience")
    expect(listPhrase(["vascular age", "resilience"])).toBe("vascular age and resilience")
    expect(listPhrase(["a", "b", "c"])).toBe("a, b and c")
    // A negative list takes "or": "No vascular age and pulse wave velocity"
    // claims both are missing together, which is not what the screen means.
    expect(listPhrase(["a", "b"], "or")).toBe("a or b")
  })
})

describe("the scope that was never asked for", () => {
  // Putting the refusal on a screen with Oura's own words attached answered
  // the question the status line could not:
  //
  //   Token is not authorized access heart_health scope.
  //   Token is not authorized access stress scope.
  //
  // Not an expired token, not a plan — two scopes the OAuth request had never
  // listed. Four figures shipped, were mapped correctly, and could never have
  // arrived.
  const oura = src("src/app/api/oura/auth/route.ts")

  it("asks for the scopes the newer endpoints need", () => {
    // daily_cardiovascular_age and vO2_max need heart_health;
    // daily_resilience needs stress.
    expect(oura, "the endpoint ships and the column stays empty forever")
      .toContain('"heart_health"')
    expect(oura).toContain('"stress"')
  })

  it("still asks for the ones that were already working", () => {
    // Adding two must not drop seven. A scope removed here is a column that
    // goes quiet with no error anywhere.
    for (const scope of ["personal", "email", "daily", "heartrate", "workout", "session", "spo2", "tag"]) {
      expect(oura, `${scope} was granted and is still needed`).toContain(`"${scope}"`)
    }
  })

  it("says how to actually get them, since adding the scope is not enough", () => {
    // The part that would otherwise leave the columns blank forever: a token
    // already issued never gains a permission it was not granted, so the
    // request changing helps nobody who is already connected.
    const said = scopeRemedy("Oura", {
      at: "2026-09-13T13:00:00Z", ok: true,
      endpoints: { daily_resilience: { state: "failed", reason: "401 Unauthorized — Token is not authorized access stress scope" } },
    })!
    expect(said).toContain("reconnect Oura")
    expect(said).toContain("Settings")
  })

  it("invents no errand when the refusal is not about scope", () => {
    // A plan that excludes an endpoint cannot be reconnected into existence,
    // and "never point at a remedy that isn't one" is the rule here.
    expect(scopeRemedy("Oura", {
      at: "2026-09-13T13:00:00Z", ok: true,
      endpoints: { vO2_max: { state: "failed", reason: "402 Payment Required" } },
    })).toBeNull()
    expect(scopeRemedy("Oura", {
      at: "2026-09-13T13:00:00Z", ok: true,
      endpoints: { vO2_max: { state: "empty" } },
    })).toBeNull()
    expect(scopeRemedy("Oura", undefined)).toBeNull()
  })

  it("leaves the screen to supply the full stop", () => {
    // It rendered "…heart_health scope.." on a phone: Oura ends its own
    // sentence, and the page adds one after the quote.
    expect(ouraErrorDetail('{"detail":"Token is not authorized access stress scope."}'))
      .toBe("Token is not authorized access stress scope")
  })
})
