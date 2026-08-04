import React from "react"

// Minimal markdown for Emergy's chat bubbles: **bold** (rendered in green,
// Emergy's accent), *italic*, `code`, "- " bullets and "## " headings.
// Streaming-safe — unmatched markers render as plain text until closed.

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g

function renderInline(text: string): React.ReactNode {
  const parts = text.split(INLINE_RE)
  if (parts.length === 1) return text
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i} className="font-semibold text-green-300">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={i} className="px-1 py-0.5 rounded bg-black/30 text-[0.85em]">{part.slice(1, -1)}</code>
    }
    return part
  })
}

export function ChatMarkdown({ text }: { text: string }) {
  const lines = text.split("\n")
  return (
    <div className="space-y-0.5">
      {lines.map((line, i) => {
        const heading = line.match(/^#{1,4}\s+(.*)/)
        if (heading) {
          return <p key={i} className="font-bold text-green-300 mt-1.5">{renderInline(heading[1])}</p>
        }
        const bullet = line.match(/^\s*[-•]\s+(.*)/)
        if (bullet) {
          return (
            <p key={i} className="pl-4 relative">
              <span className="absolute left-1 text-green-500/70">•</span>
              {renderInline(bullet[1])}
            </p>
          )
        }
        if (line.trim() === "") return <div key={i} className="h-2" />
        return <p key={i}>{renderInline(line)}</p>
      })}
    </div>
  )
}
