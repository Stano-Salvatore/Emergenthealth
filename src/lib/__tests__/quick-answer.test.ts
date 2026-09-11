import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { parseQuickAsk } from "@/lib/quick-answer"

// Both lists are the real transcript. The refusals are the important half: a
// change that makes one of them match means the app has started answering a
// question that wanted a judgement, in a voice that sounds certain.

describe("parseQuickAsk — ours", () => {
  it("reads the most asked question in the whole transcript", () => {
    // Seven times, word for word.
    expect(parseQuickAsk("How was my sleep this week?")).toEqual({ kind: "sleep", window: "week" })
    expect(parseQuickAsk("how was my sleep this week")).toEqual({ kind: "sleep", window: "week" })
    expect(parseQuickAsk("how did I sleep the past week?")).toEqual({ kind: "sleep", window: "week" })
  })

  it("reads a single night", () => {
    expect(parseQuickAsk("how was my sleep last night?")).toEqual({ kind: "sleep", window: "night" })
    expect(parseQuickAsk("how did I sleep last night")).toEqual({ kind: "sleep", window: "night" })
  })

  it("reads sleep debt as its own question", () => {
    expect(parseQuickAsk("any sleep debt?")).toEqual({ kind: "sleep", window: "week", debt: true })
    expect(parseQuickAsk("am I behind on sleep this week?")).toEqual({ kind: "sleep", window: "week", debt: true })
  })

  it("reads today's log", () => {
    expect(parseQuickAsk("so whats logged today?")).toEqual({ kind: "logged_today" })
    expect(parseQuickAsk("what did I log today?")).toEqual({ kind: "logged_today" })
    expect(parseQuickAsk("what's logged today")).toEqual({ kind: "logged_today" })
  })

  it("reads one drink's total", () => {
    expect(parseQuickAsk("so how much beer did i log today?")).toEqual({ kind: "intake_total", type: "beer", label: "beer" })
    expect(parseQuickAsk("how much water have I had today?")).toEqual({ kind: "intake_total", type: "water", label: "water" })
    expect(parseQuickAsk("how much coffee today?")).toEqual({ kind: "intake_total", type: "coffee", label: "coffee" })
  })

  it("reads today's doses", () => {
    expect(parseQuickAsk("What supplements did I take today?")).toEqual({ kind: "doses_today" })
    expect(parseQuickAsk("what pills did I take today?")).toEqual({ kind: "doses_today" })
  })

  it("reads what is still circulating", () => {
    expect(parseQuickAsk("So what is in my body rn?")).toEqual({ kind: "body_now" })
    expect(parseQuickAsk("what's in my system right now?")).toEqual({ kind: "body_now" })
  })
})

describe("parseQuickAsk — his, not ours", () => {
  it.each([
    // Real questions from the transcript that want a judgement.
    ["Why has my sleep been rough lataly?", "why"],
    ["Does coffee affect my sleep? Check my Oura tags", "affect"],
    ["how was my sleep? alcohol affecting sleep?", "two questions"],
    ["So what is in my body rn? and what about my sleep tonight? i mean what should I watch for", "two questions"],
    ["What has the biggest impact on my health? Sleep and readines. also look at my notes :)", "impact"],
    ["hey! whats one interesting correlation / insight?", "insight"],
    ["What shoul I chanhe to feel more energetic?", "should"],
    ["Look at every insight. which do you think are badly comouted?", "think"],
    ["What effect does Kaviaren vtak have on me? so.e interesting stuff? corelations?", "two questions"],
    ["Can you compare everything from 18.8.2026 to today against rest of this year?", "compare"],
    ["What does effect my health the most? Coffee? Place where I been?", "two questions"],
    ["Good. So, what interesring insigths can you give me?", "insight"],
    // Shapes that look close but are not a lookup.
    ["how was my sleep?", "no window stated"],
    ["how did I sleep?", "no window stated"],
    ["how was my sleep this week and last night?", "two windows"],
    ["what did I eat today and how much water?", "two things"],
    ["how much beer is too much?", "a judgement"],
    ["what's my sleep goal?", "a setting, not a reading"],
    ["log 300ml water", "not a question at all"],
    ["what supplements should I take?", "should"],
    ["", "empty"],
  ])("%s → his (%s)", message => {
    expect(parseQuickAsk(message)).toBeNull()
  })

  it("refuses a question long enough to be carrying a second thought", () => {
    expect(parseQuickAsk("how was my sleep this week " + "x".repeat(120))).toBeNull()
  })
})

describe("the answers stay in front of the model, and stay honest", () => {
  const route = readFileSync("src/app/api/chat/route.ts", "utf8")
  const run = readFileSync("src/lib/quick-answer-run.ts", "utf8")
  const chart = readFileSync("src/app/api/chat/chart/route.ts", "utf8")
  const markdown = readFileSync("src/components/emergy/ChatMarkdown.tsx", "utf8")

  it("runs before streamChatEvents", () => {
    expect(route.indexOf("runQuickAnswer")).toBeGreaterThan(-1)
    expect(route.indexOf("runQuickAnswer")).toBeLessThan(route.indexOf("streamChatEvents(userId"))
  })

  it("only tries a question the log parser did not already take", () => {
    expect(route).toMatch(/runQuickLog[\s\S]{0,400}\?\?[\s\S]{0,300}runQuickAnswer/)
  })

  it("never draws its own conclusion about a number", () => {
    // These answers report. Whether a number is good, and why it moved, is
    // Emergy's to say — a script that editorialises is claiming a judgement it
    // never made.
    const verdicts = /\b(?:that's (?:good|great|bad|poor)|well done|not great|too (?:much|little)|you should|try to|worrying|concerning|excellent|nice work)\b/i
    expect(run).not.toMatch(verdicts)
  })

  it("says what is missing rather than averaging over the gap", () => {
    expect(run).toContain("no data")
    expect(run).toMatch(/const missing =/)
  })

  it("does not count a night that has not happened as a night with no data", () => {
    // Asked at 03:00, tonight's row does not exist yet — the ring files a night
    // under the day you wake. Counting it as a gap invents one, and a false gap
    // trains the reader to ignore the real ones.
    expect(run).toMatch(/const pending =/)
    expect(run).toMatch(/days - nights\.length - pending/)
    expect(run).toContain("isn't in yet")
  })

  it("reads the sleep fields that were stored for months and never surfaced", () => {
    for (const field of ["sleepLatency", "sleepEfficiency", "sleepStart"]) {
      expect(run, `${field} is stored on 91% of nights`).toContain(field)
    }
  })

  it("resolves chart data server-side from a whitelist", () => {
    // A reply names a chart; it never carries data points. An unknown spec
    // renders nothing, the same rule the source chips follow.
    expect(chart).toMatch(/const SPECS = \[/)
    expect(chart).toMatch(/status: 404/)
    expect(markdown).toMatch(/\[chart:/)
  })

  it("builds its receipts with the same function the model's use", () => {
    expect(run).toContain("chipsFromClaim")
    expect(run).not.toMatch(/label: "Sleep"/)
  })
})
