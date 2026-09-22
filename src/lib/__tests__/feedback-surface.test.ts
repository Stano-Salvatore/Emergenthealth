import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// The feedback surface, and the two ways it had already rotted when a sweep
// for the placeName bug-shape reached it.
//
// 1. /api/feedback GET returns UserFeedback rows with the author joined in as
//    a NESTED object — `include: { user: { select: { email, name } } }` — so
//    the name lives at `row.user.name`. The inbox read `f.name || f.email`,
//    two fields that have never existed at the top level of that response,
//    and every card's byline rendered as a bare " · 2 days ago". Untyped
//    fetch boundary, so the compiler never saw it. Same disease, new organ.
//
// 2. The type vocabulary had three copies drifting apart: the form sends
//    "praise", the inbox's icon map knew "praise" — and the route's email
//    emoji map only knew "love", a value nothing has sent it. Every piece of
//    praise notified the owner under the fallback 💬 instead of ❤️. Nothing
//    errored; the wrong emoji is not an exception.

const FORM = "src/components/dashboard/FeedbackForm.tsx"
const INBOX = "src/components/settings/FeedbackInbox.tsx"
const ROUTE = "src/app/api/feedback/route.ts"

const stripped = (file: string): string =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")

/** The quoted members of `export type FeedbackType = "a" | "b" | ...`. */
const formTypes = (): string[] => {
  const m = /export type FeedbackType = ([^\n]+)/.exec(stripped(FORM))
  if (!m) return []
  return [...m[1].matchAll(/"(\w+)"/g)].map(x => x[1]).sort()
}

/** The keys of a `const NAME: Record<...> = { key: ..., }` object literal. */
const recordKeys = (file: string, name: string): string[] => {
  const m = new RegExp(`const ${name}[^=]*= \\{([\\s\\S]*?)\\n\\}`).exec(stripped(file))
  if (!m) return []
  return [...m[1].matchAll(/^\s*(\w+):/gm)].map(x => x[1]).sort()
}

describe("the feedback inbox reads the shape the route returns", () => {
  it("takes the author from the nested user object", () => {
    const src = stripped(INBOX)
    expect(
      src.includes("f.user?.name || f.user?.email"),
      "FeedbackInbox no longer reads f.user?.name / f.user?.email. /api/feedback GET joins the author " +
        "in as `user: { email, name }` — a NESTED object — and the response is untyped at the fetch " +
        "boundary, so nothing but this test notices a drift.",
    ).toBe(true)
    expect(
      /f\.name \|\| f\.email/.test(src),
      "FeedbackInbox is back to reading f.name || f.email. Those fields have never existed at the top " +
        "level of the /api/feedback response; every byline renders empty.",
    ).toBe(false)
  })
})

describe("the feedback type vocabulary agrees everywhere", () => {
  // Three copies of one list: the form names what a person can send, the
  // route picks the email emoji, the inbox picks the card icon. A value in
  // the form that either map does not know falls back silently — no error,
  // just the wrong glyph, forever.
  it("every type the form can send has an emoji in the route and an icon in the inbox", () => {
    const sent = formTypes()
    expect(
      sent.length,
      `No FeedbackType union found in ${FORM} — if it moved or was renamed, this guard is reading nothing.`,
    ).toBeGreaterThanOrEqual(3)

    const emoji = recordKeys(ROUTE, "TYPE_EMOJI")
    const icons = recordKeys(INBOX, "TYPE_ICON")

    for (const t of sent) {
      expect(
        emoji.includes(t),
        `The form sends "${t}" but ${ROUTE}'s TYPE_EMOJI has [${emoji.join(", ")}] — the owner email ` +
          "for that type falls back to 💬 without a sound.",
      ).toBe(true)
      expect(
        icons.includes(t),
        `The form sends "${t}" but ${INBOX}'s TYPE_ICON has [${icons.join(", ")}] — the card icon ` +
          "for that type silently falls back to the suggestion bulb.",
      ).toBe(true)
    }

    // The page's self-reported errors land in the same table under "error"
    // (src/app/api/client-error/route.ts), and the inbox must know that one
    // too — it is the row type a person never sends.
    expect(
      icons.includes("error"),
      "TYPE_ICON no longer knows \"error\", the type client-error rows are written under.",
    ).toBe(true)
  })
})
