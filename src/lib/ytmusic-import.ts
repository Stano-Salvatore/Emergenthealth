// YouTube Music listening history, parsed out of a Google Takeout.
//
// Takeout exports watch history as one enormous HTML page (this user's is
// 41 MB), not JSON. Each activity sits in an "outer-cell" block; a music play
// is the block whose watch link points at music.youtube.com, with the track
// title as that link's text, the artist as the following channel link (the
// auto-generated "X - Topic" channels), and a timestamp like
// "Aug 25, 2026, 5:17:19 PM CEST".
//
// Parsed client-side — the file is far too big to upload to a serverless
// route, and a few thousand extracted plays are a couple hundred kilobytes.
// The result uses the same {name, artist, uts} shape Last.fm scrobbles reduce
// to, so the server can feed it straight through bucketScrobbles and the rest
// of the music pipeline never learns there was a second source.
//
// Two honest limitations, both accepted:
//  · Takeout localises month names to the account language. This parses the
//    English export; a differently-localised file parses zero plays and the
//    importer says so rather than guessing.
//  · Takeout stamps every timestamp with the timezone at EXPORT time (a file
//    exported in August says CEST even on January plays), so winter entries
//    can sit an hour off. Day-bucketing barely notices.

export interface YtMusicPlay {
  name: string
  artist: string
  /** Unix seconds. */
  uts: number
}

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Sept: 8, Oct: 9, Nov: 10, Dec: 11,
}

/** Minutes east of UTC for the abbreviations Takeout actually stamps. An
 * unlisted zone falls back to UTC — an hour or two of skew beats losing the
 * play entirely. */
const TZ_OFFSET_MIN: Record<string, number> = {
  UTC: 0, GMT: 0, WET: 0, BST: 60, WEST: 60, IST: 60,
  CET: 60, CEST: 120, EET: 120, EEST: 180, MSK: 180,
}

// Google pads the time with ordinary, no-break or narrow no-break spaces
// depending on the export's vintage.
const SP = "[\\s\\u00a0\\u202f]"
const TIME_RE = new RegExp(
  `([A-Z][a-z]{2,3})${SP}(\\d{1,2}),${SP}(\\d{4}),${SP}(\\d{1,2}):(\\d{2}):(\\d{2})${SP}*(AM|PM)${SP}+([A-Z]{2,5})`,
)

const TITLE_RE = /href="https:\/\/music\.youtube\.com\/watch[^"]*"[^>]*>([^<]*)</
const ARTIST_RE = /href="https:\/\/(?:www\.|music\.)?youtube\.com\/channel\/[^"]*"[^>]*>([^<]*)</

/** The handful of entities Takeout emits inside titles and channel names. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim()
}

export function parseWatchHistory(html: string): YtMusicPlay[] {
  const plays: YtMusicPlay[] = []
  const seen = new Set<string>()

  // Splitting on the cell marker keeps memory linear in the file and avoids
  // parsing 40 MB of Material-Design boilerplate as a DOM.
  for (const cell of html.split("outer-cell")) {
    const title = TITLE_RE.exec(cell)
    if (!title) continue

    const time = TIME_RE.exec(cell)
    if (!time) continue
    const month = MONTHS[time[1]]
    if (month == null) continue

    let hour = Number(time[4]) % 12
    if (time[7] === "PM") hour += 12
    const offsetMin = TZ_OFFSET_MIN[time[8]] ?? 0
    const uts = Math.floor(
      Date.UTC(Number(time[3]), month, Number(time[2]), hour, Number(time[5]), Number(time[6])) / 1000,
    ) - offsetMin * 60

    const name = decodeEntities(title[1])
    if (!name) continue

    // The channel link is the artist; "X - Topic" is YouTube's auto channel
    // naming, not part of anyone's name. A rare cell has no channel at all.
    const artistMatch = ARTIST_RE.exec(cell)
    const artist = artistMatch
      ? decodeEntities(artistMatch[1]).replace(/\s*-\s*Topic\s*$/, "")
      : ""

    // Takeout occasionally carries the same play twice.
    const key = `${uts}:${name}`
    if (seen.has(key)) continue
    seen.add(key)

    plays.push({ name, artist, uts })
  }

  return plays
}
