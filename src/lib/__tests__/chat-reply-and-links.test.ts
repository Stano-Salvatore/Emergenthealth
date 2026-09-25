import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const stripped = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

describe("a streamed reply is saved before the stream says it is done", () => {
  // The reply was persisted AFTER controller.close(). On Vercel, closing the
  // response is the signal that lets the function be frozen — so the save ran
  // only when the runtime felt like it. A reply streamed fully to the screen,
  // was never written, and vanished when the chat reloaded. Found by
  // screenshot, twice in one evening.
  it("the assistant message is written before [DONE] is enqueued", () => {
    const route = stripped("src/app/api/chat/route.ts")
    const stream = route.slice(route.indexOf("new ReadableStream"))
    const persist = stream.indexOf("chatMessage.create")
    const done = stream.indexOf("[DONE]")
    expect(persist, "the stream block no longer persists the reply at all").toBeGreaterThan(-1)
    expect(done).toBeGreaterThan(-1)
    expect(
      persist < done,
      "The reply is persisted after [DONE]/close. Once the response closes, the serverless runtime may freeze " +
        "the function, and the save silently never happens — the reply the user watched stream then vanishes on reload.",
    ).toBe(true)
  })
})

describe("Emergy can point at a page the user can actually tap", () => {
  it("ChatMarkdown renders internal links as navigation", () => {
    const md = readFileSync("src/components/emergy/ChatMarkdown.tsx", "utf8")
    expect(md).toMatch(/\[\^?\\\]|\\\[[^\n]*\\\]\(|\\\]\(/)
    expect(md, "internal links need client-side navigation, not a full reload").toMatch(/from "next\/link"/)
  })

  it("the prompt tells him which paths exist", () => {
    const chat = stripped("src/lib/claude.ts")
    for (const path of ["/dashboard/insights", "/dashboard/experiments", "/dashboard/health"]) {
      expect(chat, `the prompt's route list is missing ${path}`).toContain(path)
    }
  })
})
