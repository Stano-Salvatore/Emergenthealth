import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { parseQuickAsk } from "@/lib/quick-answer"

// Both lists are the real transcript. The refusals are the important half: a
// change that makes one of them match means the app has started answering a
// question that wanted a judgement, in a voice that sounds certain.

// The chat screen's briefing button sends this exact message. Every part of it
// is a lookup, and it used to buy a full model turn.
const BRIEFING_BUTTON =
  "Give me a morning briefing: last night's sleep score and quality, today's schedule, " +
  "which habits I still need to do, any overdue reminders, and what supplements/meds I've taken so far."

describe("parseQuickAsk — the briefing", () => {
  it("answers the button, long as it is", () => {
    expect(parseQuickAsk(BRIEFING_BUTTON)).toEqual({ kind: "briefing" })
    expect(BRIEFING_BUTTON.length).toBeGreaterThan(120)
  })

  it("takes the shorter ways of asking for one", () => {
    expect(parseQuickAsk("brief me")).toEqual({ kind: "briefing" })
    expect(parseQuickAsk("daily briefing")).toEqual({ kind: "briefing" })
  })

  it("still hands over anything asking for a judgement about it", () => {
    expect(parseQuickAsk("why was my morning briefing wrong")).toBeNull()
    expect(parseQuickAsk("should I trust the daily briefing")).toBeNull()
  })

  it("does not take a long message that merely mentions a brief", () => {
    expect(parseQuickAsk("I read a briefing about sleep hygiene somewhere and wondered about it")).toBeNull()
  })
})

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

  it("reads sleep regularity as its own question, with no window to state", () => {
    expect(parseQuickAsk("is my sleep regular?")).toEqual({ kind: "sleep_rhythm" })
    expect(parseQuickAsk("how consistent is my sleep")).toEqual({ kind: "sleep_rhythm" })
    expect(parseQuickAsk("do I go to bed at the same time?")).toEqual({ kind: "sleep_rhythm" })
    expect(parseQuickAsk("is my sleep all over the place this week")).toEqual({ kind: "sleep_rhythm" })
    // One night cannot be regular or irregular, so this is not the question.
    expect(parseQuickAsk("was my sleep regular last night")).not.toEqual({ kind: "sleep_rhythm" })
    // "Regularly" is an adverb about frequency, not about rhythm.
    expect(parseQuickAsk("do I regularly sleep badly this week")).not.toEqual({ kind: "sleep_rhythm" })
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

// The five questions still reaching the model after the briefing landed. Each
// was measured in the real chat history, each has one true answer the database
// already holds, and each was buying a full Opus turn with forty-one tool
// schemas to read a single row.
describe("parseQuickAsk — the five that were still costing a model turn", () => {
  it("reads the habits still due", () => {
    expect(parseQuickAsk("what habits am I missing today")).toEqual({ kind: "habits_today" })
    expect(parseQuickAsk("which habits do I still have left today")).toEqual({ kind: "habits_today" })
    expect(parseQuickAsk("have I done all my habits today?")).toEqual({ kind: "habits_today" })
  })

  it("reads the day's calendar, however it is asked for", () => {
    expect(parseQuickAsk("what's on today?")).toEqual({ kind: "events_today" })
    expect(parseQuickAsk("what do I have today")).toEqual({ kind: "events_today" })
    expect(parseQuickAsk("what's on my calendar today")).toEqual({ kind: "events_today" })
    expect(parseQuickAsk("any meetings today?")).toEqual({ kind: "events_today" })
  })

  it("reads steps, and needs a window like sleep does", () => {
    expect(parseQuickAsk("how many steps today")).toEqual({ kind: "steps", window: "today" })
    expect(parseQuickAsk("how many steps this week?")).toEqual({ kind: "steps", window: "week" })
    expect(parseQuickAsk("how many steps")).toBeNull()
  })

  it("reads caffeine as milligrams, and coffee as millilitres", () => {
    // Two different questions that share a word. The dose is what decides
    // whether tonight is affected; the volume is what was drunk.
    expect(parseQuickAsk("how is my caffeine today")).toEqual({ kind: "caffeine_today" })
    expect(parseQuickAsk("how much caffeine have I had today")).toEqual({ kind: "caffeine_today" })
    expect(parseQuickAsk("how much coffee today")).toEqual({ kind: "intake_total", type: "coffee", label: "coffee" })
    // And "still in me" is the body-load question, which already existed.
    expect(parseQuickAsk("how much caffeine is still in my body")).toEqual({ kind: "body_now" })
  })

  it("reads the scale, with and without a window", () => {
    expect(parseQuickAsk("what did I weigh last week")).toEqual({ kind: "weight", window: "week" })
    // The window is read before the figure guard, so the digit in "7 days"
    // does not send a perfectly clear question to the model.
    expect(parseQuickAsk("what did I weigh in the last 7 days")).toEqual({ kind: "weight", window: "week" })
    expect(parseQuickAsk("how many steps in the last 7 days")).toEqual({ kind: "steps", window: "week" })
    expect(parseQuickAsk("what do I weigh")).toEqual({ kind: "weight", window: "latest" })
    expect(parseQuickAsk("what's my weight?")).toEqual({ kind: "weight", window: "latest" })
  })

  it.each([
    ["what habits should I add?", "should"],
    ["which habit is my best streak?", "best"],
    ["what should I do today?", "should"],
    ["am I getting enough steps today?", "enough"],
    ["why are my steps down this week?", "why"],
    ["what's my weight goal?", "a setting, not a reading"],
    ["how much weight did I lift today?", "a workout, not a scale"],
    ["should I lose weight?", "should"],
    ["do my steps affect my sleep this week?", "affect"],
    // A figure in the message means it is telling the app something, or
    // naming a day neither window covers. Both are Emergy's.
    ["log my weight 78.4", "a statement, not a question"],
    ["I weigh 78.4 today", "a statement, not a question"],
    ["what did I weigh on 10 Sept", "a day, not a window"],
    ["I did 12000 steps today", "a statement, not a question"],
    ["had 200mg of caffeine today", "a statement, not a question"],
  ])("%s → his (%s)", message => {
    expect(parseQuickAsk(message)).toBeNull()
  })
})

describe("parseQuickAsk — what Emergy costs", () => {
  it("answers the question the effort knob exists to settle", () => {
    expect(parseQuickAsk("what have you cost me")).toEqual({ kind: "chat_spend" })
    expect(parseQuickAsk("how much do you cost")).toEqual({ kind: "chat_spend" })
    expect(parseQuickAsk("what has emergy cost so far")).toEqual({ kind: "chat_spend" })
    expect(parseQuickAsk("how many tokens do you use")).toEqual({ kind: "chat_spend" })
  })

  it.each([
    // The app holds their bank transactions too, so a bare spending question
    // is about their money and belongs to him, not to this.
    ["how much did I spend this week?", "their money, not his"],
    ["what did I spend on groceries today?", "their money, not his"],
    ["how much does a coffee cost here?", "no mention of him"],
    ["are you worth what you cost?", "worth is a judgement"],
  ])("%s → his (%s)", message => {
    expect(parseQuickAsk(message)).toBeNull()
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
  const claude = readFileSync("src/lib/claude.ts", "utf8")

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

  it("has one copy of the habit rule and one of the day's events", () => {
    // The briefing and the two new answers ask the same two questions. A
    // second copy of either is how two screens start disagreeing about what
    // is due today.
    expect(run.match(/isDueOn\(/g) ?? []).toHaveLength(1)
    expect(run.match(/mergeDayEvents\(/g) ?? []).toHaveLength(1)
  })

  it("never calls a step count final while the day is still running", () => {
    expect(run).toContain("so far today")
    expect(run).toContain("still counting")
    // And a partial day is not allowed into the week's mean, or to win
    // "fewest": at 09:00 today is the lowest day of any week there has been.
    expect(run).toMatch(/const done = counted\.filter\(r => r\.day !== today\)/)
    expect(run).toMatch(/const avg = total \/ done\.length/)
  })

  it("keeps the cost of a turn in a row, not only in a log line", () => {
    // Runtime logs on this project last about a day. At one or two messages a
    // day, "read a week of turn lines" never has a week to read.
    expect(claude).toContain("recordModelTurn")
    expect(claude).toMatch(/feature: "chat"/)
    // One row per tool round trip, so a message that called three tools reads
    // as the three turns it really was.
    expect(claude).toMatch(/effort, turn,/)
  })

  it("answers by feature first, because that is what a surprising bill asks", () => {
    expect(run).toContain("prisma.modelTurn.findMany")
    expect(run).toMatch(/tally\(r => r\.feature\)/)
    // The effort split is chat's alone: the photo paths choose their own
    // effort per call, so mixing them would compare a meal guess to a chat.
    expect(run).toMatch(/priced\.filter\(r => r\.feature === "chat"\)/)
  })

  it("does not tell the user one arm is a comparison", () => {
    expect(run).toContain("nothing to compare it against yet")
  })

  it("never prints a real cost as $0.00", () => {
    // The briefing runs on Haiku and genuinely costs under a cent a call;
    // "$0.00" beside the other lines would read as free.
    expect(run).toMatch(/const money = \(n: number\) => \(n >= 0\.01 \? /)
  })

  it("has one floor for 'still circulating', not two", () => {
    // The body-load answer and the caffeine total both say it. Two constants
    // is how one of them starts calling 1mg a fact about the afternoon.
    expect(run.match(/CAFFEINE_FLOOR_MG =/g) ?? []).toHaveLength(1)
    expect(run.match(/>= CAFFEINE_FLOOR_MG/g) ?? []).toHaveLength(2)
  })

  it("dates a weight rather than letting a stale reading pass for today's", () => {
    expect(run).toMatch(/recorded \$\{latest\.day === today/)
    expect(run).toContain("Nothing weighed in the last seven days")
  })

  it("builds its receipts with the same function the model's use", () => {
    expect(run).toContain("chipsFromClaim")
    expect(run).not.toMatch(/label: "Sleep"/)
  })
})
