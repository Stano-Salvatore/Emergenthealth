import { describe, it, expect } from "vitest"
import { createSourceFilter, chipsFromClaim, chipsFromTools, toolActivity } from "@/lib/chat-sources"

/** Feed a reply through the filter one chunk at a time, as the stream would. */
function run(chunks: string[]): { text: string; keys?: string[] } {
  const f = createSourceFilter()
  let text = ""
  let keys: string[] | undefined
  for (const c of chunks) {
    const out = f.push(c)
    text += out.text
    if (out.keys) keys = out.keys
  }
  const end = f.flush()
  text += end.text
  if (end.keys) keys = end.keys
  return keys ? { text, keys } : { text }
}

describe("createSourceFilter", () => {
  it("passes ordinary prose through untouched", () => {
    expect(run(["You slept ", "badly.\nGo ", "gently today."]))
      .toEqual({ text: "You slept badly.\nGo gently today." })
  })

  it("takes the marker off the end and reports its keys", () => {
    const out = run(["Four short nights.\n", "[sources: sleep, journal]"])
    expect(out.text).toBe("Four short nights.\n")
    expect(out.keys).toEqual(["sleep", "journal"])
  })

  it("swallows the marker when it arrives split across chunks", () => {
    const out = run(["Short night.\n", "[sou", "rces: sl", "eep]"])
    expect(out.text).toBe("Short night.\n")
    expect(out.keys).toEqual(["sleep"])
  })

  it("never leaks the marker when more text follows it on a later line", () => {
    const out = run(["Hi.\n[sources: sleep]", "\nOne more thought."])
    expect(out.text).toBe("Hi.\nOne more thought.")
    expect(out.keys).toEqual(["sleep"])
  })

  // The whole point of the streaming filter: a final sentence must not wait
  // for the stream to end just because a marker might be coming.
  it("does not hold back a normal trailing partial line", () => {
    const f = createSourceFilter()
    expect(f.push("You slept ").text).toBe("You slept ")
    expect(f.push("badly").text).toBe("badly")
  })

  it("leaves a bracketed phrase that is not the marker alone", () => {
    expect(run(["Worth a look [see Patterns] this week."]))
      .toEqual({ text: "Worth a look [see Patterns] this week." })
  })

  it("drops a marker the stream cut off half-way", () => {
    expect(run(["Short night.\n", "[sources: sle"])).toEqual({ text: "Short night.\n" })
  })

  it("keeps prose the model wrote after the closing bracket", () => {
    const out = run(["[sources: sleep] and that's that."])
    expect(out.text).toBe(" and that's that.")
    expect(out.keys).toEqual(["sleep"])
  })

  it("reads an empty marker as no sources rather than one blank chip", () => {
    expect(run(["Just saying hi.\n[sources: ]"])).toEqual({ text: "Just saying hi.\n", keys: [] })
  })
})

describe("chipsFromClaim", () => {
  const manifest = { sleep: "30 nights", journal: "4 entries" }

  it("renders only what the prompt actually carried", () => {
    const chips = chipsFromClaim(["sleep", "journal"], manifest)
    expect(chips.map(c => c.label)).toEqual(["Sleep", "Journal"])
    expect(chips.map(c => c.detail)).toEqual(["30 nights", "4 entries"])
  })

  // The reason this function exists: Emergy citing something we never gave him
  // must not reach the screen.
  it("drops a source that was never in the prompt", () => {
    expect(chipsFromClaim(["sleep", "labs"], manifest).map(c => c.key)).toEqual(["sleep"])
  })

  it("drops a source that does not exist at all", () => {
    expect(chipsFromClaim(["research", "places"], manifest)).toEqual([])
  })

  it("orders chips the same way whatever order they were claimed in", () => {
    expect(chipsFromClaim(["journal", "sleep"], manifest).map(c => c.key))
      .toEqual(chipsFromClaim(["sleep", "journal"], manifest).map(c => c.key))
  })

  it("tints by domain, never by status", () => {
    expect(chipsFromClaim(["sleep", "journal"], manifest).map(c => c.domain)).toEqual(["sleep", "mind"])
  })
})

describe("chipsFromTools", () => {
  it("makes a chip for a tool that reads", () => {
    expect(chipsFromTools(["get_health_range"])[0].label).toBe("Health history")
  })

  it("ignores tools that only write — logging is an action, not a source", () => {
    expect(chipsFromTools(["log_water", "remember", "create_habit"])).toEqual([])
  })

  it("shows a repeatedly called tool once", () => {
    expect(chipsFromTools(["get_health_range", "get_health_range"])).toHaveLength(1)
  })
})

describe("toolActivity", () => {
  it("says what he is doing in his own terms", () => {
    expect(toolActivity("get_health_range")).toBe("reading your health history")
  })

  it("never leaks a function name for a tool it does not know", () => {
    expect(toolActivity("some_new_tool")).toBe("having a look")
  })
})

// He is asked to put the marker on a line of its own, and usually does. One
// missing newline used to send it straight to the screen — and into the stored
// transcript, where it stayed for good.
describe("createSourceFilter · marker after prose", () => {
  it("takes a marker off the end of a sentence", () => {
    const out = run(["Go gently today. [sources: sleep]\n"])
    expect(out.text).toBe("Go gently today.\n")
    expect(out.keys).toEqual(["sleep"])
  })

  // Split across chunks the space before "[" is already out the door by the
  // time the marker shows up. Holding trailing whitespace on the chance a
  // marker follows would delay every ordinary word break, which is a far worse
  // trade than one space that renders as nothing.
  it("takes it off even when it arrives split mid-sentence", () => {
    const out = run(["Go gently ", "today. [sour", "ces: sleep, journal]\n"])
    expect(out.text).toBe("Go gently today. ")
    expect(out.keys).toEqual(["sleep", "journal"])
  })

  it("drops a mid-sentence marker the stream cut off", () => {
    expect(run(["Go gently today. [sources: sle"])).toEqual({ text: "Go gently today. " })
  })

  it("still leaves an ordinary bracket in the middle of a sentence alone", () => {
    expect(run(["A look [see Patterns] and [notes] this week."]))
      .toEqual({ text: "A look [see Patterns] and [notes] this week." })
  })
})
