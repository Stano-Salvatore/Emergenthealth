import { describe, it, expect } from "vitest"
import { parseWatchHistory } from "@/lib/ytmusic-import"

// A cell shaped exactly like Takeout's watch-history.html emits them.
function cell(opts: {
  href?: string
  title?: string
  channel?: string
  channelHost?: string
  time?: string
}): string {
  const {
    href = "https://music.youtube.com/watch?v=BkHkKIeAa5M",
    title = "Její tělo rezonuje",
    channel = "DG 307 - Topic",
    channelHost = "www.youtube.com",
    time = "Aug 25, 2026, 5:17:19 PM CEST",
  } = opts
  const channelLink = channel
    ? `<a href="https://${channelHost}/channel/UCcL34hXqHhwBbvUYB9aSf7g">${channel}</a><br>`
    : ""
  return `outer-cell mdl-cell"><div class="mdl-grid"><div class="header-cell"><p>YouTube Music<br></p></div>` +
    `<div class="content-cell">Watched <a href="${href}">${title}</a><br>${channelLink}${time}<br></div>`
}

describe("parseWatchHistory", () => {
  it("reads a play: title, artist without the Topic suffix, local time as UTC seconds", () => {
    const [play] = parseWatchHistory(cell({}))
    expect(play.name).toBe("Její tělo rezonuje")
    expect(play.artist).toBe("DG 307")
    // 17:17:19 CEST (+02:00) on Aug 25 2026 = 15:17:19 UTC
    expect(play.uts).toBe(Date.UTC(2026, 7, 25, 15, 17, 19) / 1000)
  })

  it("handles morning times, midnight, and winter CET", () => {
    const [am] = parseWatchHistory(cell({ time: "Jan 3, 2026, 9:05:00 AM CET" }))
    expect(am.uts).toBe(Date.UTC(2026, 0, 3, 8, 5, 0) / 1000)
    const [midnight] = parseWatchHistory(cell({ time: "Jan 3, 2026, 12:10:00 AM CET" }))
    expect(midnight.uts).toBe(Date.UTC(2026, 0, 2, 23, 10, 0) / 1000)
    const [noon] = parseWatchHistory(cell({ time: "Jan 3, 2026, 12:10:00 PM CET" }))
    expect(noon.uts).toBe(Date.UTC(2026, 0, 3, 11, 10, 0) / 1000)
  })

  it("tolerates the narrow no-break spaces newer exports pad times with", () => {
    const spaced = cell({ time: "Aug 25, 2026, 5:17:19 PM CEST" })
    expect(parseWatchHistory(spaced)).toHaveLength(1)
  })

  it("decodes entities in titles and artists", () => {
    const [play] = parseWatchHistory(cell({
      title: "Don&#39;t Stop &amp; Go",
      channel: "Simon &amp; Garfunkel - Topic",
    }))
    expect(play.name).toBe("Don't Stop & Go")
    expect(play.artist).toBe("Simon & Garfunkel")
  })

  it("keeps a play whose cell has no channel link, with an empty artist", () => {
    const [play] = parseWatchHistory(cell({ channel: "" }))
    expect(play.name).toBe("Její tělo rezonuje")
    expect(play.artist).toBe("")
  })

  it("skips plain YouTube videos — only music.youtube.com watches are plays", () => {
    const video = cell({ href: "https://www.youtube.com/watch?v=abc123" })
    expect(parseWatchHistory(video)).toEqual([])
  })

  it("drops a duplicated play but keeps the same track at a different time", () => {
    const twice = cell({}) + cell({}) + cell({ time: "Aug 25, 2026, 6:00:00 PM CEST" })
    expect(parseWatchHistory(twice)).toHaveLength(2)
  })

  it("has nothing to say about a file with no music in it", () => {
    expect(parseWatchHistory("<html><body>hello</body></html>")).toEqual([])
  })
})
