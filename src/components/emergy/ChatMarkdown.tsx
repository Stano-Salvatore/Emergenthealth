import React from "react"

// Minimal markdown for Emergy's replies: **bold**, *italic*, `figures`,
// "- " bullets, "## " headings and "> " quotes from the user's own journal.
// Streaming-safe — unmatched markers render as plain text until closed.
//
// Nothing here is tinted with a status colour. Green means "on target" across
// the app (design/handoff/README.md), so a green figure inside a sentence
// arguing the opposite would contradict the words around it. The source chips
// under a reply carry the hue instead.

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g

function renderInline(text: string): React.ReactNode {
  const parts = text.split(INLINE_RE)
  if (parts.length === 1) return text
  return parts.map((part, i) => {
    // Recurse: he writes **`500ml`** often enough, and without this the inner
    // figure never got parsed — the backticks rendered as literal characters
    // in the middle of a bold phrase.
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i} className="font-semibold">{renderInline(part.slice(2, -2))}</strong>
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{renderInline(part.slice(1, -1))}</em>
    }
    // A figure he read from the data. It reads as part of the sentence — a
    // boxed mono token made "6.1h in bed" look like code quoted mid-prose.
    // Tabular figures are the only treatment left, so digits still line up
    // down a column of bullets.
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <span key={i} className="tabular-nums">{part.slice(1, -1)}</span>
    }
    return part
  })
}

/** The user's own words, quoted back. Mind is the journal's domain hue. */
function Quote({ lines }: { lines: string[] }) {
  return (
    <blockquote className="my-2 border-l-2 border-mind/70 bg-black/20 rounded-r-xl pl-3 pr-3 py-2 italic text-muted-foreground">
      {lines.map((line, i) => <p key={i}>{renderInline(line)}</p>)}
    </blockquote>
  )
}

export function ChatMarkdown({ text }: { text: string }) {
  const lines = text.split("\n")
  const blocks: React.ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Consecutive "> " lines are one quote, not a stack of them.
    const quote = line.match(/^\s*>\s?(.*)/)
    if (quote) {
      const quoted = [quote[1]]
      while (i + 1 < lines.length) {
        const next = lines[i + 1].match(/^\s*>\s?(.*)/)
        if (!next) break
        quoted.push(next[1])
        i++
      }
      blocks.push(<Quote key={i} lines={quoted} />)
      continue
    }

    const heading = line.match(/^#{1,4}\s+(.*)/)
    if (heading) {
      blocks.push(<p key={i} className="font-semibold mt-1.5">{renderInline(heading[1])}</p>)
      continue
    }

    const bullet = line.match(/^\s*[-•]\s+(.*)/)
    if (bullet) {
      blocks.push(
        <p key={i} className="pl-4 relative">
          <span className="absolute left-1 text-muted-foreground">•</span>
          {renderInline(bullet[1])}
        </p>
      )
      continue
    }

    if (line.trim() === "") {
      blocks.push(<div key={i} className="h-2" />)
      continue
    }

    blocks.push(<p key={i}>{renderInline(line)}</p>)
  }

  return <div className="space-y-0.5">{blocks}</div>
}
