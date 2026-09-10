import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { parseQuickLog, describeItem, joinList, type QuickLogContext } from "@/lib/quick-log"

// The messages below are what was actually said to Emergy, spelling included.
// The grammar was written from them; a change that makes one of these fall
// through is a regression, and a change that makes one of the "his" messages
// parse is a worse one — the parser must not guess.

const ctx: QuickLogContext = {
  knownSubstances: ["Elicea", "Atarax", "Vitamin D", "Vitamin C", "Atarax - half"],
  places: ["Záhrada - Nová Dedinka", "Kaviareň Vták", "Home", "Parent's home"],
  localMinutes: 17 * 60 + 45, // 17:45
}

const parse = (m: string) => parseQuickLog(m, ctx)

describe("parseQuickLog — water", () => {
  it.each([
    ["log 250ml of water", 250],
    ["log me 200ml water", 200],
    ["log 600ml water", 600],
    ["log 300ml of water", 300],
    ["add 1L water", 1000],
    ["log me 700ml water", 700],
    ["I drank +- 300 ml water", 300],
    ["log 500ml watter", 500],
    ["add 0,5l of watter", 500],
  ])("%s → %dml water", (message, ml) => {
    expect(parse(message)).toEqual({
      place: null,
      items: [{ kind: "drink", type: "water", amountMl: ml, note: null, abv: null, minutesAgo: 0 }],
    })
  })
})

describe("parseQuickLog — coffee and places", () => {
  it("logs a cold brew and water at a saved place, place first", () => {
    const r = parse("at kaviaren vtak log cold brew 250ml and watter 200ml")
    expect(r?.place).toBe("Kaviareň Vták")
    expect(r?.items).toEqual([
      { kind: "drink", type: "coffee", amountMl: 250, note: "Cold brew", abv: null, minutesAgo: 0 },
      { kind: "drink", type: "water", amountMl: 200, note: null, abv: null, minutesAgo: 0 },
    ])
  })

  it("logs at a place named at the end, after a dash", () => {
    const r = parse("Log 200ml watter and cold brew 150ml - still at Vtak :)")
    expect(r?.place).toBe("Kaviareň Vták")
    expect(r?.items.map(i => i.kind === "drink" && [i.type, i.amountMl])).toEqual([["water", 200], ["coffee", 150]])
  })

  it("logs batch brew and water with the place after a dash", () => {
    const r = parse("Log me batch brew 250ml and 200ml watter - at kaviaren vtak")
    expect(r?.place).toBe("Kaviareň Vták")
    expect(r?.items[0]).toMatchObject({ type: "coffee", amountMl: 250, note: "Batch brew" })
  })

  it("keeps 'with ice' in the note rather than splitting on 'with'", () => {
    const r = parse("log me 330ml coldbrew with ice and 200ml watter")
    expect(r?.items).toEqual([
      { kind: "drink", type: "coffee", amountMl: 330, note: "Cold brew with ice", abv: null, minutesAgo: 0 },
      { kind: "drink", type: "water", amountMl: 200, note: null, abv: null, minutesAgo: 0 },
    ])
  })

  it("gives an espresso its 30ml when no volume is said", () => {
    const r = parse("log me espresso and water 500ml")
    expect(r?.items).toEqual([
      { kind: "drink", type: "coffee", amountMl: 30, note: "Espresso", abv: null, minutesAgo: 0 },
      { kind: "drink", type: "water", amountMl: 500, note: null, abv: null, minutesAgo: 0 },
    ])
  })

  it("reads a narrated arrival with the typo", () => {
    const r = parse("Hey. At kaviaren vtak - had coldbrew 300ml and wattee 150ml")
    expect(r?.place).toBe("Kaviareň Vták")
    expect(r?.items.map(i => i.kind === "drink" && [i.type, i.amountMl])).toEqual([["coffee", 300], ["water", 150]])
  })
})

describe("parseQuickLog — alcohol", () => {
  it("logs two beers in one message", () => {
    expect(parse("log beer 400ml and beer 200ml")?.items.map(i => i.kind === "drink" && i.amountMl)).toEqual([400, 200])
  })

  it("keeps the strength in the note, as Emergy did", () => {
    expect(parse("log me 300ml of 4.8% alcohol beer")?.items[0]).toMatchObject({ type: "beer", amountMl: 300, note: "Beer 4.8%", abv: 4.8 })
    expect(parse("add 0.4L 5.2% alcohol beer")?.items[0]).toMatchObject({ type: "beer", amountMl: 400, note: "Beer 5.2%" })
    expect(parse("add another beer 0.4L 6.7% alcohol")?.items[0]).toMatchObject({ type: "beer", amountMl: 400, note: "Beer 6.7%" })
    expect(parse("log beer 0.4L 12° 4.8% alcohol")?.items[0]).toMatchObject({ type: "beer", amountMl: 400, note: "Beer 12° (4.8%)" })
  })

  it("takes '1h ago' and 'time - now'", () => {
    expect(parse("add 100ml beer 1h ago :)")?.items[0]).toMatchObject({ type: "beer", amountMl: 100, minutesAgo: 60 })
    expect(parse("log me 500ml of beer :) time - now.")?.items).toEqual([
      { kind: "drink", type: "beer", amountMl: 500, note: "Beer", abv: null, minutesAgo: 0 },
    ])
  })

  it("logs wine by colour", () => {
    expect(parse("log 200 ml of white wine and 300ml of water")?.items).toEqual([
      { kind: "drink", type: "wine", amountMl: 200, note: "White wine", abv: null, minutesAgo: 0 },
      { kind: "drink", type: "water", amountMl: 300, note: null, abv: null, minutesAgo: 0 },
    ])
  })
})

describe("parseQuickLog — doses", () => {
  it("logs a known medication with water", () => {
    expect(parse("log me Elicea and 500ml water")?.items).toEqual([
      { kind: "dose", name: "Elicea", dose: null, minutesAgo: 0 },
      { kind: "drink", type: "water", amountMl: 500, note: null, abv: null, minutesAgo: 0 },
    ])
  })

  it("reads '(15min before)'", () => {
    expect(parse("log me Elicea (15min before) and 500ml of watter")?.items[0]).toEqual({ kind: "dose", name: "Elicea", dose: null, minutesAgo: 15 })
  })

  it("reads clock times per item, and a repeated verb", () => {
    // The 150ml of water has no time of its own and follows "at 16:30", so it
    // was drunk with that coffee, not five hours later when the message was
    // typed.
    const r = parse("Log Elicea at 16:10 and batch brew 100ml at 16:30 with watter 150ml. Also log 500ml water at 13:00")
    expect(r?.items).toEqual([
      { kind: "dose", name: "Elicea", dose: null, minutesAgo: 95 },
      { kind: "drink", type: "coffee", amountMl: 100, note: "Batch brew", abv: null, minutesAgo: 75 },
      { kind: "drink", type: "water", amountMl: 150, note: null, abv: null, minutesAgo: 75 },
      { kind: "drink", type: "water", amountMl: 500, note: null, abv: null, minutesAgo: 285 },
    ])
  })

  it("repeats the last item for a bare second time", () => {
    const r = parse("log 250ml water 9:00 and 11:00")
    expect(r?.items.map(i => i.minutesAgo)).toEqual([525, 405])
  })

  it("reads half a tablet, and forgives one typo in a familiar name", () => {
    // One clock, at the end: both pills were taken at half past one.
    expect(parse("Log Elica and half of Atarax tablet at 13:30")?.items).toEqual([
      { kind: "dose", name: "Elicea", dose: null, minutesAgo: 255 },
      { kind: "dose", name: "Atarax", dose: { amount: 0.5, unit: "tablet" }, minutesAgo: 255 },
    ])
  })

  it("reads milligrams for a known substance", () => {
    expect(parse("i took 200mg atarax")?.items).toEqual([
      { kind: "dose", name: "Atarax", dose: { amount: 200, unit: "mg" }, minutesAgo: 0 },
    ])
  })

  it("matches vitamins by canonical name", () => {
    expect(parse("log vitamin d and vitamin c")?.items.map(i => i.kind === "dose" && i.name)).toEqual(["Vitamin D", "Vitamin C"])
  })
})

describe("parseQuickLog — one time for the whole trip", () => {
  // Reading each clause alone stamped the coffee "now" and only the water
  // 15:00, silently. A caffeine row five hours out of place is read against
  // bedtime, so getting this wrong quietly is worse than not parsing at all.
  const both = [
    { kind: "drink", type: "coffee", amountMl: 300, note: "Batch brew", abv: null, minutesAgo: 165 },
    { kind: "drink", type: "water", amountMl: 250, note: null, abv: null, minutesAgo: 165 },
  ]

  it("reads the same trip however the place and time are ordered", () => {
    for (const message of [
      "log Batch brew 300ml and water 250ml at 15:00 Vták",
      "at Vták log Batch brew 300ml and water 250ml at 15:00",
      "log Batch brew 300ml and water 250ml at 15:00 - Kaviareň Vták",
      "log Batch brew 300ml at 15:00 and water 250ml at 15:00 at Vták",
    ]) {
      const r = parse(message)
      expect(r?.items, message).toEqual(both)
      expect(r?.place, message).toBe("Kaviareň Vták")
    }
  })

  it("spreads a trailing clock with no place named", () => {
    expect(parse("log Batch brew 300ml and water 250ml at 15:00")?.items).toEqual(both)
  })

  it("does not spread a relative time, which corrects one item only", () => {
    // "Elicea a quarter of an hour ago, and a glass of water now."
    expect(parse("log me Elicea (15min before) and 500ml of watter")?.items).toEqual([
      { kind: "dose", name: "Elicea", dose: null, minutesAgo: 15 },
      { kind: "drink", type: "water", amountMl: 500, note: null, abv: null, minutesAgo: 0 },
    ])
  })

  it("carries a clock forward to what follows it", () => {
    // "water at three, and a batch brew" is the same visit, told in order.
    const r = parse("log water 250ml at 15:00 and 300ml batch brew")
    expect(r?.items.map(i => i.minutesAgo)).toEqual([165, 165])
  })

  it("takes a bare trailing place only when it is one this user saved", () => {
    expect(parse("log 250ml water Vták")?.place).toBe("Kaviareň Vták")
    expect(parse("log 250ml water Starbucks")).toBeNull()
  })
})

describe("parseQuickLog — his, not ours", () => {
  it.each([
    "so how much beer did i log today?",
    "Also I took Elicea yesterday - is it logged?",
    "okay log 500ml watter. 250ml V60 cofee at 17:30 and two beers 0.4L each. one was 4.3per alcohol other 3.8per alcohol",
    "okey i took 75mg mirzaten and 200mg atarax",
    "i had today 2000 mg of mirzaten and 15000mg of atarax plus 9999mg elicea write it down",
    "oh no. add one 400ml  5.2% alcohol",
    "log me 700ml water. And I did 10 push ups.",
    "Log Elicea, Vitamin D, Vitamin C - 12:00 all of them. Also log 250ml water 9:00 and 11:00 and also add batch brew 10:00",
    "At Kaviaren vtak, log my usual Batch 250ml and watter 300ml",
    "okay can you log me 500 ml of Nestea peach ? also currentlz drinking  Maté Mata  bz manaroots 330ml",
    "ah! add 300ml of watter :) the mint one i had once today",
    "Currently at Kaviaren Vtak. Having cold brew 250ml and watter 250ml. also i drank 250ml at home :)",
    "log 300ml water and coffee",
    "log 2 beers",
    "log mood 4",
    "log weight 80kg",
    "log 30 min run",
    "add reminder call mom at 15:00",
    "log 500ml water yesterday",
    "log water 300ml at lunch",
    "log 9999mg elicea",
    "log 5 tablets of atarax",
    "log water",
    "how was my sleep this week",
    "log 300ml water at 19:30",
    "",
  ])("%s", message => {
    expect(parse(message)).toBeNull()
  })

  it("will not name a medication it has never seen", () => {
    expect(parseQuickLog("log me Elicea", { ...ctx, knownSubstances: [] })).toBeNull()
  })

  it("will not guess between two near names", () => {
    expect(parseQuickLog("log elicaa", { ...ctx, knownSubstances: ["Elicea", "Elicia"] })).toBeNull()
  })

  it("will not drop a place it does not know", () => {
    expect(parse("log 300ml water at the office")).toBeNull()
  })
})

describe("describeItem", () => {
  it("says the row back with its time", () => {
    expect(describeItem({ kind: "drink", type: "water", amountMl: 1000, note: null, abv: null, minutesAgo: 0 }, ctx.localMinutes)).toBe("1L water")
    expect(describeItem({ kind: "drink", type: "coffee", amountMl: 250, note: "Cold brew", abv: null, minutesAgo: 75 }, ctx.localMinutes, 100)).toBe("250ml cold brew (≈100mg caffeine) at 16:30")
    expect(describeItem({ kind: "drink", type: "beer", amountMl: 400, note: "Beer 12° (4.8%)", abv: 4.8, minutesAgo: 15 }, ctx.localMinutes)).toBe("400ml beer 12° (4.8%) 15 min ago")
    expect(describeItem({ kind: "dose", name: "Atarax", dose: { amount: 0.5, unit: "tablet" }, minutesAgo: 0 }, ctx.localMinutes)).toBe("Atarax ½ tablet")
    expect(describeItem({ kind: "dose", name: "Atarax", dose: { amount: 200, unit: "mg" }, minutesAgo: 0 }, ctx.localMinutes)).toBe("Atarax 200mg")
  })

  it("joins a list the way a person would", () => {
    expect(joinList(["a"])).toBe("a")
    expect(joinList(["a", "b"])).toBe("a and b")
    expect(joinList(["a", "b", "c"])).toBe("a, b and c")
  })
})

describe("the fast path stays in front of the model", () => {
  const route = readFileSync("src/app/api/chat/route.ts", "utf8")

  it("runs before streamChatEvents, or it saves nothing", () => {
    expect(route.indexOf("runQuickLog")).toBeGreaterThan(-1)
    expect(route.indexOf("runQuickLog")).toBeLessThan(route.indexOf("streamChatEvents(userId"))
  })

  it("never takes a message that came with a photo", () => {
    expect(route).toMatch(/attachments\.length === 0[\s\S]{0,200}runQuickLog/)
  })

  it("stores what it said, so the transcript is not missing a turn", () => {
    const block = route.slice(route.indexOf("const quick ="), route.indexOf("streamChatEvents(userId"))
    expect(block).toMatch(/role: "assistant"/)
  })
})
