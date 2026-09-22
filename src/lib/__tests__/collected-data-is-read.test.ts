import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

// A table the app writes and nothing reads is not a neutral gap. It becomes a
// lie the moment some other surface says "no data" for the thing it holds.
//
// That is exactly what happened to PhoneSleepSegment. 3.3.0 shipped the Sleep
// API collection for "the nights the ring was on its charger", wrote the rows
// faithfully — and nothing read them. So on precisely those nights the daily
// brief still told the model "NO SLEEP DATA ... never invent or imply sleep
// figures", and the quick answer still said "No sleep data for last night",
// while the estimate sat in the table. The feature's whole promise was hollow
// and no test noticed, because every test passed: the writer worked.
//
// This guard holds the writer and the reader together. It does NOT demand that
// every table be read — plenty are written for export or for a future pass,
// and saying so is a decision, not an oversight. It demands that the tables
// listed here, which exist to answer a question the app asks out loud, have
// somebody asking.

const SRC = "src"

/** Every .ts/.tsx under src, excluding tests. */
const sourceFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue
      out.push(...sourceFiles(full))
      continue
    }
    if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const readersOf = (delegate: string, writerPaths: string[]): string[] => {
  const calls = new RegExp(`prisma\\.${delegate}\\.(findMany|findFirst|findUnique|count|aggregate|groupBy)`)
  return sourceFiles(SRC).filter(f => {
    if (writerPaths.some(w => f.endsWith(w))) return false
    return calls.test(readFileSync(f, "utf8"))
  })
}

// delegate → the file(s) that WRITE it, which do not count as readers.
const MUST_BE_READ: { delegate: string; writers: string[]; because: string }[] = [
  {
    delegate: "phoneSleepSegment",
    writers: ["api/phone/sensors/route.ts"],
    because:
      "the app says \"no sleep data\" on exactly the nights these rows cover, so an unread table here " +
      "is the app calling itself ignorant while holding the answer",
  },
  {
    delegate: "activitySpan",
    writers: ["api/activity/transitions/route.ts"],
    because:
      "walking and transit minutes are the movement the app points at when it talks about a day, and " +
      "the brief now promises not to call such a day inactive",
  },
]

describe("data the app collects, something reads", () => {
  it.each(MUST_BE_READ)("$delegate has a reader", ({ delegate, writers, because }) => {
    const readers = readersOf(delegate, writers)
    expect(
      readers.length,
      `Nothing reads prisma.${delegate} outside ${writers.join(", ")} — it is written and never used. ` +
        `That matters here because ${because}. Either wire a reader, or if this is deliberately deferred, ` +
        "take it off the list in this test with the reason, so the decision is visible instead of silent.",
    ).toBeGreaterThan(0)
  })
})

describe("the brief does not claim ignorance it does not have", () => {
  const brief = readFileSync("src/app/api/briefing/route.ts", "utf8")

  it("asks the phone before saying there is no sleep", () => {
    // Order matters as much as presence: the fallback has to be consulted on
    // the branch that would otherwise assert nothing is known.
    const noData = brief.indexOf("NO SLEEP DATA for last night")
    const phoneRead = brief.indexOf("phoneSleep")
    expect(phoneRead, "The brief no longer reads phone sleep at all.").toBeGreaterThan(-1)
    expect(
      phoneRead < noData,
      "The brief asserts NO SLEEP DATA before consulting the phone's own estimate. On a night the ring " +
        "was not worn that is the app denying what it holds.",
    ).toBe(true)
  })

  it("tells the model what the day's movement was", () => {
    // The "four weeks without training" bug was not a wording problem: the
    // prompt contained no step count at all, so nothing could contradict it.
    expect(
      /steps/i.test(brief),
      "The brief carries no step count. The training block can say \"no Strava sessions in four weeks\", " +
        "and with no steps anywhere in the prompt the model has nothing to weigh that against — which is " +
        "how it told someone who walked 12,000 steps that they had not trained in a month.",
    ).toBe(true)
  })
})

describe("the phone's buffers are emptied on foreground, not only in Settings", () => {
  // The rows the guard above insists on being READ have to ARRIVE first.
  // Light, pressure, screen moments, the Sleep API's nights and the travel
  // modes are parked natively and shipped only when the web layer asks — and
  // for a release the only askers were two Settings cards. So the sleep
  // fallback that 3.3.4 built read a table that stayed empty for anyone who
  // never opened Settings: written faithfully on the phone, capped, and never
  // sent. Comments are stripped before matching, because the comment
  // explaining this bug names the very calls it checks for.
  const stripped = (file: string): string =>
    readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("NativeBridge ships both buffers every time the app comes to the front", () => {
    const bridge = stripped("src/components/NativeBridge.tsx")
    for (const call of ["uploadPhoneSensors(", "uploadActivityEvents("]) {
      expect(
        bridge.includes(call),
        `NativeBridge.tsx no longer calls ${call}). The phone's buffers then reach the server only ` +
          "while a Settings card is on screen, and the app claims \"no sleep data\" over nights the phone recorded.",
      ).toBe(true)
    }
    // The call has to be inside the foreground handler, not only the mount:
    // a phone that stays open all day still drains on the next return.
    const handler = bridge.slice(bridge.indexOf("const onVisible"))
    expect(handler, "the foreground handler in NativeBridge no longer drains the phone").toMatch(/drainPhone\(\)/)
  })

  it("one uploader, and it posts to the routes that write the tables", () => {
    const helper = stripped("src/lib/native/phone-uploads.ts")
    expect(helper).toContain('"/api/phone/sensors"')
    expect(helper).toContain('"/api/activity/transitions"')
    // Nothing else may post those routes: a second copy in a card is how the
    // drain came to exist only in Settings in the first place.
    for (const f of sourceFiles(SRC)) {
      if (f.endsWith("phone-uploads.ts")) continue
      const c = stripped(f)
      expect(c, `${f} posts /api/phone/sensors itself; use uploadPhoneSensors()`).not.toContain('"/api/phone/sensors"')
      expect(c, `${f} posts /api/activity/transitions itself; use uploadActivityEvents()`).not.toContain('"/api/activity/transitions"')
    }
  })
})

describe("the other sleep readers consult the phone too", () => {
  // The brief learned this in 3.3.4; the chat prompt — the one Emergy reads
  // on every turn — still told him "never state or imply sleep figures" over
  // nights the phone had recorded, and the weekly review averaged "no data".
  // One helper (lib/phone-sleep) now, and the two readers ask it BEFORE they
  // assert ignorance.
  const stripped = (file: string): string =>
    readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("the chat prompt asks the phone before forbidding sleep figures", () => {
    const chat = stripped("src/lib/claude.ts")
    const ask = chat.indexOf("phoneNights(")
    const forbid = chat.indexOf("never state or imply")
    expect(ask, "claude.ts no longer reads phone sleep at all").toBeGreaterThan(-1)
    expect(forbid).toBeGreaterThan(-1)
    expect(ask < forbid, "claude.ts forbids sleep figures before consulting the phone's estimate").toBe(true)
    expect(chat, "the prohibition must be scoped to RING figures now that phone estimates are offered").toMatch(/imply RING sleep figures/)
  })

  it("the weekly review names the ring and lists the phone's nights apart", () => {
    const review = stripped("src/lib/weekly-review.ts")
    expect(review, "weekly-review.ts no longer reads phone sleep").toContain("phoneNights(")
    expect(review, "the review's sleep average must say which instrument it averaged").toMatch(/Sleep \(ring\): avg/)
    // Kept apart on purpose: a motion guess folded into the ring average is
    // a number that is not a measurement.
    expect(review).not.toMatch(/avg\(\[\.\.\.thisWeekLogs[^\n]*phone/)
  })
})
