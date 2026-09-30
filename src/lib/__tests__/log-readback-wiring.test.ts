import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { REF_KINDS } from "@/lib/log-refs"
import { chipsFromTools, toolActivity } from "@/lib/chat-sources"

// "What was my blood pressure last week?" had no tool behind it, and "delete
// that pizza" reached a find/delete machinery that only knew doses, drinks and
// moments. The pure halves are tested in log-readback.test.ts; this holds the
// wiring in claude.ts to the same rules the existing kinds follow.

const strip = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

const src = strip("src/lib/claude.ts")

const handler = (tool: string) => {
  const open = src.indexOf(`if (name === "${tool}")`)
  expect(open, `handler for ${tool} not found`).toBeGreaterThan(-1)
  const next = src.indexOf(`if (name === "`, open + 1)
  return src.slice(open, next === -1 ? undefined : next)
}

/** A function body, from its signature to the next top-level declaration. */
const fn = (name: string) => {
  const open = src.indexOf(`async function ${name}(`)
  expect(open, `${name} not found`).toBeGreaterThan(-1)
  const next = src.slice(open + 1).search(/\n(async function|function|const|export) /)
  return src.slice(open, next === -1 ? undefined : open + 1 + next)
}

/** The schema object for one tool, as the model sees it. */
const schema = (tool: string) => {
  const open = src.indexOf(`name: "${tool}",`)
  expect(open, `schema for ${tool} not found`).toBeGreaterThan(-1)
  const next = src.indexOf(`    name: "`, open + 1)
  return src.slice(open, next === -1 ? undefined : next)
}

describe("get_logs", () => {
  it("is a tool Emergy can call", () => {
    expect(schema("get_logs")).toMatch(/"food", "bp", "metric", "symptom"/)
  })

  it("reads only the asking user's rows", () => {
    const h = handler("get_logs")
    for (const table of ["foodLog", "bloodPressureLog", "customMetric", "customMetricLog", "symptomLog"]) {
      const at = h.indexOf(`prisma.${table}.findMany`)
      expect(at, `${table} is not read`).toBeGreaterThan(-1)
      expect(h.slice(at, at + 200), `${table} read without userId`).toContain("userId")
    }
  })

  it("works in the user's days, not the server's", () => {
    const h = handler("get_logs")
    expect(h).toContain("getUserTimezone(userId)")
    expect(h).toContain("zonedDayRange(tz")
    expect(h).toContain("localDateStr(tz)")
  })

  it("does not report a failed read as an empty log", () => {
    // "No food logged" over a Neon blip is the read-side twin of "Logged"
    // over a write that never happened.
    expect(handler("get_logs")).not.toContain(".catch(() => [])")
    expect(handler("get_logs")).toMatch(/[Ww]orth retrying/)
  })

  it("shows as a source and says what it is doing", () => {
    expect(chipsFromTools(["get_logs"])).toHaveLength(1)
    expect(toolActivity("get_logs")).not.toBe("having a look")
  })
})

describe("find / correct / delete reach the logs Emergy writes", () => {
  it("allows food, bp, metric and symptom refs", () => {
    for (const k of ["food", "bp", "metric", "symptom"]) expect(REF_KINDS).toContain(k)
  })

  it("offers the new kinds to find_my_logs", () => {
    expect(schema("find_my_logs")).toMatch(/enum: \["dose", "intake", "moment", "food", "bp", "metric", "symptom"\]/)
    const h = handler("find_my_logs")
    for (const k of ["food", "bp", "metric", "symptom"]) expect(h).toContain(`makeRef("${k}"`)
  })

  it("scopes every lookup, delete and update by userId", () => {
    for (const f of ["describeRef", "deleteRef", "correctRef"]) {
      const body = fn(f)
      for (const table of ["foodLog", "bloodPressureLog", "customMetricLog", "symptomLog"]) {
        const at = body.indexOf(`prisma.${table}.`)
        expect(at, `${f} does not handle ${table}`).toBeGreaterThan(-1)
        expect(body.slice(at, at + 120), `${f}: ${table} without userId`).toContain("userId")
      }
    }
  })

  it("deleting a meal takes the drinks it mirrored with it, as the Food tab does", () => {
    const body = fn("deleteRef")
    expect(body).toContain("food_${ref.id}_")
    expect(body).toContain("forgetDrinkCaffeine")
  })

  it("keeps the two-step confirm for every kind", () => {
    const h = handler("delete_log")
    expect(h.indexOf("issueConfirmToken")).toBeLessThan(h.indexOf("deleteRef("))
    expect(h.indexOf("verifyConfirmToken")).toBeLessThan(h.indexOf("deleteRef("))
  })

  it("validates a correction per kind before touching anything", () => {
    const h = handler("correct_log")
    expect(h.indexOf("correctionProblem(")).toBeGreaterThan(-1)
    expect(h.indexOf("correctionProblem(")).toBeLessThan(h.indexOf("correctRef("))
  })

  it("tells the model how to fix a blood pressure reading", () => {
    expect(schema("correct_log")).toContain("systolic")
    expect(schema("correct_log")).toContain("diastolic")
  })
})

describe("moving a meal's time", () => {
  it("moves the drinks it mirrored and their caffeine with it", () => {
    const src = readFileSync("src/lib/claude.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
    const block = src.slice(src.indexOf("async function correctRef"))
    const food = block.slice(block.indexOf('ref.kind === "food"'), block.indexOf('ref.kind === "bp"'))
    expect(food).toMatch(/intakeLog\.updateMany\(\{[\s\S]*?startsWith: `food_\$\{ref\.id\}_`[\s\S]*?loggedAt/)
    expect(food).toMatch(/caffeineLog\.updateMany\(\{[\s\S]*?caffeineIdFor\(`food_\$\{ref\.id\}_`\)/)
  })
})
