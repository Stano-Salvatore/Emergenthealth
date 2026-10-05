import { describe, it, expect } from "vitest"
import { createElement, Fragment } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { renderInline } from "@/components/emergy/ChatMarkdown"

// A link Emergy writes with a path is drawn as an in-app button and opens in
// place. "//host/…" and "/\host/…" also start with a slash, but a browser
// reads both as another site — so a reply steered by text it was shown (a
// calendar event, a note) could dress an outside page as one of the app's.

const html = (text: string) => renderToStaticMarkup(createElement(Fragment, null, renderInline(text)))

describe("only the app's own paths are drawn as the app's", () => {
  it("a path is an in-app link", () => {
    expect(html("[Sleep](/dashboard/sleep)")).toContain('href="/dashboard/sleep"')
  })

  it("a protocol-relative link is not", () => {
    expect(html("[Sleep](//evil.example/dashboard)")).not.toContain('href="//evil.example')
    expect(html("[Sleep](/\\evil.example/dashboard)")).not.toContain("href=")
  })
})
