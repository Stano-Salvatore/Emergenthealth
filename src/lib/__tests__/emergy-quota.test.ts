import { describe, it, expect, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { DAILY_EMERGY_LIMIT, isOwnerEmail, quotaReply, remainingFrom } from "@/lib/emergy-quota"

const strip = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("who is limited", () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })

  it("the owner is not, whatever the case of the address", () => {
    process.env.FEEDBACK_NOTIFY_EMAIL = "Owner@Example.com"
    expect(isOwnerEmail("owner@example.com")).toBe(true)
    expect(isOwnerEmail("friend@example.com")).toBe(false)
    expect(isOwnerEmail(null)).toBe(false)
  })

  it("with no owner configured, everyone is", () => {
    delete process.env.FEEDBACK_NOTIFY_EMAIL
    delete process.env.OWNER_EMAIL
    expect(isOwnerEmail("owner@example.com")).toBe(false)
  })
})

describe("the reply when the day's messages are used", () => {
  it("names the limit and what still works, and only what the quick path really answers", () => {
    const r = quotaReply()
    expect(r).toContain(String(DAILY_EMERGY_LIMIT))
    expect(r).toMatch(/tomorrow/)
    expect(r).toMatch(/log 300ml water/)
    expect(r).toMatch(/how was my sleep this week/)
  })

  it("from Telegram, which has no quick path, it points to the app instead", () => {
    expect(quotaReply("telegram")).toMatch(/In the app's chat/)
    expect(strip("src/app/api/telegram/webhook/route.ts")).toMatch(/quotaReply\("telegram"\)/)
  })
})

describe("wiring", () => {
  it("web chat: quick logs and lookups are answered before the count, the model only after it", () => {
    const src = strip("src/app/api/chat/route.ts")
    const quick = src.indexOf("runQuickAnswer(")
    const claim = src.indexOf("claimEmergyTurn(")
    const model = src.indexOf("streamChatEvents(")
    expect(quick).toBeGreaterThan(-1)
    expect(claim).toBeGreaterThan(quick)
    expect(model).toBeGreaterThan(claim)
  })

  it("Telegram reaches the same model, so it spends the same allowance", () => {
    const src = strip("src/app/api/telegram/webhook/route.ts")
    expect(src.indexOf("claimEmergyTurn(")).toBeGreaterThan(-1)
    expect(src.indexOf("claimEmergyTurn(")).toBeLessThan(src.indexOf("streamChatResponse(userId"))
  })
})

describe("what's left today", () => {
  it("counts down from today's turns; another day or an unreadable value is a full allowance", () => {
    expect(remainingFrom(null, "2026-10-01")).toBe(DAILY_EMERGY_LIMIT)
    expect(remainingFrom("2026-10-01:3", "2026-10-01")).toBe(DAILY_EMERGY_LIMIT - 3)
    expect(remainingFrom("2026-09-30:10", "2026-10-01")).toBe(DAILY_EMERGY_LIMIT)
    expect(remainingFrom("garbage", "2026-10-01")).toBe(DAILY_EMERGY_LIMIT)
  })

  it("never goes below zero — refused turns are counted too", () => {
    expect(remainingFrom("2026-10-01:14", "2026-10-01")).toBe(0)
  })

  it("the chat is told after every counted turn, and the screen shows it", () => {
    const route = strip("src/app/api/chat/route.ts")
    expect(route).toMatch(/type: "allowance"/)
    const page = strip("src/app/dashboard/chat/page.tsx")
    expect(page).toMatch(/\/api\/chat\/allowance/)
    expect(page).toMatch(/parsed\.type === "allowance"/)
  })
})

describe("a failed reply costs nothing", () => {
  it("the chat gives the turn back when the model throws", () => {
    const route = strip("src/app/api/chat/route.ts")
    const fail = route.indexOf('console.error("[emergy] chat failed"')
    expect(route.indexOf("refundEmergyTurn(userId)", fail)).toBeGreaterThan(fail)
  })
})
