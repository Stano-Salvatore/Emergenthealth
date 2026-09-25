import { describe, it, expect } from "vitest"
import { watchBodies } from "@/lib/watch-message"
import { readFileSync } from "node:fs"

// Found by screenshot: "2 patterns changed — tap to see." sitting in the
// Emergy chat as a plain bubble, with nothing anywhere to tap. The string was
// written for the push notification, whose tap opens the insights page, and
// then reused verbatim on a surface that cannot keep the promise.
//
// The rule these pin: an instruction may only name a gesture the surface it
// lands on actually has.

const finding = "On days you walk 40min+, mood averages 4.1 vs 3.2 on less-walked days"

describe("watchBodies", () => {
  it("says the same single change on both surfaces", () => {
    const { push, chat } = watchBodies([{ finding, reason: "strengthened" }])
    expect(push).toContain(finding)
    expect(chat).toBe(push)
  })

  it("never tells a chat bubble to tap", () => {
    const { push, chat } = watchBodies([
      { finding, reason: "strengthened" },
      { finding: "Nights after a drink, HRV averages 38ms; after a sober night, 52ms", reason: "flipped direction" },
    ])
    // The push keeps the tease — its tap genuinely opens the insights page.
    expect(push).toContain("tap")
    // The chat says the news instead, because there is nothing to tap there.
    expect(chat).not.toMatch(/tap/i)
    expect(chat).toContain(finding)
    // And it points at a surface that can actually answer. "The rest are on
    // your insights page" was a second broken promise: the page shows the
    // CURRENT patterns, not what changed, and Emergy holds the change list —
    // so the bubble sends the reader to him.
    expect(chat).toMatch(/ask me/i)
  })
})

describe("the evening check-in reads the field the API returns", () => {
  // /api/checkins returns CheckIn rows as they are, and the row's name column
  // is `place`. The card read `placeName` — a field that has never existed on
  // that response — so every stop rendered as "Somewhere", including the ones
  // the geocoder had named. Five "Somewhere"s from a day in Prague.
  //
  // The response is untyped at the fetch boundary, so the compiler can never
  // catch this drift; a grep can, and did not exist. Now it does.
  it("uses .place, and placeName stays gone", () => {
    // Comments stripped before matching — the component's own comment tells
    // the story of this bug and names the dead field while doing it, and a
    // guard that fails on the fix's documentation is the android-request-codes
    // lesson all over again, learned twice in one day.
    const src = readFileSync("src/components/checkin/EveningCheckIn.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
    expect(
      src.includes("s.place?.trim()"),
      "EveningCheckIn no longer reads s.place — if the field changed, change /api/checkins with it, " +
        "and remember the response is untyped so nothing but this test will notice.",
    ).toBe(true)
    expect(
      /placeName/.test(src),
      "EveningCheckIn references placeName again. /api/checkins returns CheckIn rows whose name " +
        "column is `place`; placeName does not exist on that response and renders every stop as " +
        "\"Somewhere\".",
    ).toBe(false)
  })
})
