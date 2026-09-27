import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// "log 300ml water", pocket the phone. The user message was saved, but the
// TURN lived inside the response stream: locking the screen cancelled the
// stream, the next enqueue threw, and the whole run died mid-flight — tools
// half-executed, reply never written, the message answerless on reopen.
//
// The contract now: the turn is unstoppable. Writing to the screen is
// best-effort (a dead stream flips clientGone and the narration stops), the
// work runs to completion under next/server's after() (which keeps the
// function alive even when the response didn't finish), and what the model
// said — or why it failed — is in the transcript either way. The client's
// half: when the app comes back to the foreground with a turn left hanging,
// it re-reads the transcript instead of trusting the half-streamed bubble.

const strip = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

describe("the server finishes the turn without an audience", () => {
  const route = strip("src/app/api/chat/route.ts")

  it("the work is kept alive past the response with after()", () => {
    expect(route).toMatch(/import \{[^}]*\bafter\b[^}]*\} from "next\/server"/)
    expect(route).toMatch(/after\(/)
  })
  it("a pocketed phone flips a flag; it never throws the turn away", () => {
    expect(route).toMatch(/cancel\(\)/)
    expect(route).toMatch(/clientGone/)
  })
  it("every enqueue goes through the one guarded sender", () => {
    expect(route.match(/controller\.enqueue/g)?.length).toBe(1)
  })
  it("a failed turn leaves its reason in the transcript, not just on a dead screen", () => {
    const at = route.indexOf("describeChatFailure(error)")
    expect(at).toBeGreaterThan(-1)
    expect(route.slice(at - 300, at)).toMatch(/full \+=/)
  })
})

describe("the chat screen catches up when the app returns", () => {
  const page = strip("src/app/dashboard/chat/page.tsx")

  it("a hanging turn is remembered and resolved from the transcript", () => {
    expect(page).toMatch(/pendingTurn/)
    expect(page).toMatch(/visibilitychange/)
    expect(page).toMatch(/\/api\/chat\?conversation=/)
  })
})
