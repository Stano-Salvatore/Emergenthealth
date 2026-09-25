import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"

// Music was collected (Last.fm sync, YT Music import), fed the correlation
// engine, and was invisible to Emergy: he could say "loud evenings correlate
// with X" but not "you played DG 307 fourteen times on Tuesday". One range
// reader, consumed by the chat tool and the MCP tool alike, so the two can
// never describe the same listening differently.

const db = vi.hoisted(() => ({
  rows: [] as unknown[],
  genres: [] as { artist: string; genre: string | null }[],
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lastfmLog: { findMany: async () => db.rows },
    artistGenre: { findMany: async () => db.genres },
  },
}))

import { musicRange } from "@/lib/music-days"

describe("musicRange", () => {
  beforeEach(() => { db.rows = []; db.genres = [] })

  it("aggregates days, sums artist plays, and joins genres", async () => {
    db.rows = [
      { date: "2026-09-23", tracksPlayed: 30, listeningMin: 95, topArtist: "DG 307", topTrack: "Degenerace", lateTracks: 4, artistPlays: { "dg 307": 14, "plastic people": 10 } },
      { date: "2026-09-24", tracksPlayed: 12, listeningMin: 40, topArtist: "Plastic People", topTrack: "Magické noci", lateTracks: 0, artistPlays: { "plastic people": 8, "dg 307": 2 } },
    ]
    db.genres = [
      { artist: "dg 307", genre: "experimental" },
      { artist: "plastic people", genre: null },
    ]
    const out = await musicRange("u1", "2026-09-23", "2026-09-24")
    expect(out.days).toHaveLength(2)
    expect(out.totalMin).toBe(135)
    expect(out.totalTracks).toBe(42)
    expect(out.topArtists[0]).toMatchObject({ artist: "plastic people", plays: 18, genre: null })
    expect(out.topArtists[1]).toMatchObject({ artist: "dg 307", plays: 16, genre: "experimental" })
  })

  it("a null listeningMin stays null: written-before-the-column is not a silent day", async () => {
    db.rows = [{ date: "2026-07-01", tracksPlayed: 5, listeningMin: null, topArtist: "X", topTrack: null, lateTracks: null, artistPlays: null }]
    const out = await musicRange("u1", "2026-07-01", "2026-07-01")
    expect(out.days[0].listeningMin).toBeNull()
    expect(out.totalMin).toBe(0)
    // No artistPlays anywhere: fall back to counting topArtist mentions.
    expect(out.topArtists[0]).toMatchObject({ artist: "x" })
  })

  it("no rows reports emptiness, not zeros dressed as a quiet week", async () => {
    const out = await musicRange("u1", "2026-09-01", "2026-09-07")
    expect(out.days).toHaveLength(0)
    expect(out.topArtists).toHaveLength(0)
  })
})

describe("both tools read the same definition", () => {
  const stripped = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("Emergy's chat has get_music through musicRange", () => {
    const chat = stripped("src/lib/claude.ts")
    expect(chat).toContain('"get_music"')
    expect(chat).toMatch(/musicRange\(/)
  })

  it("the MCP connector has it too", () => {
    const mcp = stripped("src/app/api/mcp/route.ts")
    expect(mcp).toContain('"get_music"')
    expect(mcp).toMatch(/musicRange\(/)
  })
})
