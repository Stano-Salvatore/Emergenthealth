import React from "react"
import Link from "next/link"
import { ChatChart } from "@/components/emergy/ChatChart"
import { figureClass, markFigures } from "@/lib/figure-marks"

// Minimal markdown for Emergy's replies: **bold**, *italic*, `figures`,
// "- " bullets, "## " headings and "> " quotes from the user's own journal.
// Streaming-safe — unmatched markers render as plain text until closed.
//
// Nothing here is tinted with a STATUS colour. Green means "on target" across
// the app (design/handoff/README.md), so a green figure inside a sentence
// arguing the opposite would contradict the words around it. Figures do take
// their IDENTITY hue — sleep hours indigo, HRV rose, litres cyan — which is
// the palette rule applied to prose (lib/figure-marks), and is what makes
// "you're running on 6.0h and 5.9h" findable at a glance on a phone.

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]\n]+\]\([^)\s]+\))/g

const LINK_RE = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/

/** Plain prose with its figures bold, tabular and in their domain hue. */
export function Figures({ text }: { text: string }) {
  const segs = markFigures(text)
  if (segs.length === 1 && !segs[0].figure) return <>{text}</>
  return (
    <>
      {segs.map((s, i) => s.figure
        ? <span key={i} className={figureClass(s.domain)}>{s.text}</span>
        : <React.Fragment key={i}>{s.text}</React.Fragment>)}
    </>
  )
}

export function renderInline(text: string): React.ReactNode {
  const parts = text.split(INLINE_RE)
  if (parts.length === 1) return <Figures text={text} />
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
      return <span key={i} className="tabular-nums"><Figures text={part.slice(1, -1)} /></span>
    }
    const link = LINK_RE.exec(part)
    if (link) {
      const [, label, href] = link
      if (href.startsWith("/")) {
        return (
          <Link key={i} href={href}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-primary font-medium no-underline align-baseline">
            {label} <span aria-hidden>→</span>
          </Link>
        )
      }
      if (href.startsWith("https://") || href.startsWith("http://")) {
        return <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="underline text-primary">{label}</a>
      }
      return <Figures key={i} text={part} />
    }
    return <Figures key={i} text={part} />
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

    // A chart, named but never drawn here: the tag says which one, the app
    // resolves the numbers. See ChatChart and /api/chat/chart for why a reply
    // is not allowed to carry data points of its own.
    const chart = line.match(/^\s*\[chart:([a-z0-9-]{1,40})\]\s*$/)
    if (chart) {
      blocks.push(<ChatChart key={i} spec={chart[1]} />)
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
