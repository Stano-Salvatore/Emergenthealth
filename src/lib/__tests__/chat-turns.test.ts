import { describe, it, expect } from "vitest"
import { trimToUserTurn } from "@/lib/chat-turns"

const u = (content: string) => ({ role: "user" as const, content })
const a = (content: string) => ({ role: "assistant" as const, content })

describe("trimToUserTurn", () => {
  it("leaves a window that already starts with the user alone", () => {
    const h = [u("hi"), a("hello"), u("how's my sleep")]
    expect(trimToUserTurn(h)).toEqual(h)
  })
  it("drops leading assistant turns so the API never sees one first", () => {
    expect(trimToUserTurn([a("…"), a("…"), u("q"), a("a")])).toEqual([u("q"), a("a")])
  })
  it("is empty when there is no user turn at all", () => {
    expect(trimToUserTurn([a("only me")])).toEqual([])
    expect(trimToUserTurn([])).toEqual([])
  })
})
