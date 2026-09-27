import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// fetch() resolves on a 401 and on a 500. Every screen here treated "the
// promise resolved" as "the row exists", and told the user so: a tick that
// stayed, a "Check-in complete!", a key that vanished from the list while
// still working against /api/mcp. A write the user is told about must be a
// write that happened — these pin that each one looks at the answer first.

const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

/** The body of `function name(` up to the next top-level function. */
function fnBody(src: string, name: string): string {
  const start = src.search(new RegExp(`function ${name}\\(`))
  expect(start, `${name} not found`).toBeGreaterThan(-1)
  const rest = src.slice(start + 1)
  const next = rest.search(/\n  (async )?function \w+\(|\n  const \w+ = useCallback/)
  return next === -1 ? rest : rest.slice(0, next)
}

describe("QuickHabits", () => {
  const src = code("src/components/dashboard/QuickHabits.tsx")

  it("keeps a tick only when the server took it", () => {
    // Session expired or a DB hiccup: POST answered 401/500, the tick stayed,
    // the "all done" buzz fired, and the habit was undone on reload.
    const body = fnBody(src, "toggle")
    expect(body).toMatch(/if \(!res\.ok\) throw/)
  })

  it("celebrates after the answer, not inside a state updater before it", () => {
    const body = fnBody(src, "toggle")
    expect(body.indexOf("navigator.vibrate")).toBeGreaterThan(body.indexOf("res.ok"))
  })

  it("un-ticking a skipped habit clears the skip too", () => {
    // QuickHabits shows a skip as done; un-ticking sent DELETE /complete,
    // which removed a completion that didn't exist and left the skip, so the
    // habit came back ticked on reload.
    const route = code("src/app/api/habits/[id]/complete/route.ts")
    const del = route.slice(route.indexOf("export async function DELETE"))
    expect(del).toMatch(/habitSkip\.deleteMany/)
  })
})

describe("the morning check-in", () => {
  const src = code("src/app/dashboard/checkin/page.tsx")

  it("checks the response before showing the answers as saved", () => {
    // A 401 or a cold-Neon 500 still celebrated, and the next morning the
    // day's mood and energy were missing from the score and correlations.
    const body = fnBody(src, "save")
    const ok = body.search(/if \(!res\.ok\) throw/)
    expect(ok).toBeGreaterThan(-1)
    expect(body.indexOf("setExisting(")).toBeGreaterThan(ok)
    expect(body.indexOf("navigator.vibrate")).toBeGreaterThan(ok)
  })

  it("says so when it fails, and stays on the step", () => {
    expect(src).toMatch(/saveError &&/)
    expect(src).not.toMatch(/await save\([^)]*\);\s*setStep\("done"\)\s*\}/)
  })

  it("the journal note says saved only after a 2xx", () => {
    const body = fnBody(src, "saveNote")
    const ok = body.search(/if \(!res\.ok\)/)
    expect(ok).toBeGreaterThan(-1)
    expect(body.indexOf('setNoteStatus("saved")')).toBeGreaterThan(ok)
  })
})

describe("the evening check-in", () => {
  const src = code("src/components/checkin/EveningCheckIn.tsx")

  it("every write is checked, none swallowed", () => {
    for (const ep of ["/api/mood", "/api/morning-checkin", "/api/symptoms", "/api/daily-note", "/api/reminders"]) {
      expect(src, `${ep} is posted without looking at the answer`)
        .toMatch(new RegExp(`landed\\(fetch\\("${ep.replace(/\//g, "\\/")}"`))
    }
  })

  it("a symptom is listed as logged only once it was", () => {
    const body = fnBody(src, "logSymptom")
    const ok = body.search(/if \(!ok\)/)
    expect(ok).toBeGreaterThan(-1)
    expect(body.indexOf("setLoggedSymptoms(")).toBeGreaterThan(ok)
  })

  it("the done screen names what didn't save", () => {
    expect(src).toMatch(/Didn&apos;t save/)
    expect(src, "'Journal saved' over a note that wasn't").not.toMatch(/\{note\.trim\(\) && <p>Journal saved/)
  })
})

describe("the Log tab's quick-add", () => {
  const src = code("src/app/dashboard/intake/page.tsx")

  it("never locks every chip after a network failure", () => {
    // The fetch rejected, setAdding(null) never ran, and every chip stayed
    // greyed out until the page was left.
    expect(fnBody(src, "addEntry")).toMatch(/finally\s*\{\s*setAdding\(null\)/)
  })

  it("says when a drink didn't save", () => {
    expect(fnBody(src, "addEntry")).toMatch(/res\.ok/)
    expect(src).toMatch(/addError &&/)
  })

  it("delete and edit check the answer too, and the editor stays open on failure", () => {
    expect(fnBody(src, "deleteEntry")).toMatch(/res\.ok/)
    const edit = fnBody(src, "saveEdit")
    const ok = edit.search(/if \(!res\.ok\)/)
    expect(ok).toBeGreaterThan(-1)
    expect(edit.indexOf("setEditingId(null)")).toBeGreaterThan(ok)
  })
})

describe("MCP keys", () => {
  const src = code("src/components/settings/FitKeyManager.tsx")

  it("a revoked key leaves the list only when the server deleted it", () => {
    // A 500 dropped the row, the Bearer token kept working, and the row
    // reappeared on reload — for a key revoked because it had leaked.
    const body = fnBody(src, "revokeKey")
    const ok = body.search(/if \(!res\.ok\)/)
    expect(ok).toBeGreaterThan(-1)
    expect(body.indexOf("setKeys(")).toBeGreaterThan(ok)
  })

  it("a failed create doesn't leave 'Creating…' on screen for good", () => {
    expect(fnBody(src, "createKey")).toMatch(/finally\s*\{\s*setCreating\(false\)/)
    expect(src).toMatch(/error &&/)
  })
})
