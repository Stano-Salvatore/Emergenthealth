export type Change = { finding: string; reason: string }

/** One insight's baseline in insights_watch_state. */
export type WatchEntry = { delta: number; confident: boolean; tier?: string; graduated?: boolean }

type Observed = { delta: number; confident: boolean; tier: string }

/**
 * The baseline to store for today's reading.
 *
 * `graduated` is sticky: once a card has been Solid it stays marked through
 * a wobble below the cutoff, so one slipping to suggestive and back is not
 * announced as a new solid pattern each time. Only falling all the way to
 * noise clears it, and then a real return is news again. A baseline stored
 * before the flag existed counts as graduated if it was already Solid.
 */
export function watchStateFor(ins: Observed, prev: WatchEntry | undefined): WatchEntry {
  const graduated = ins.tier === "strong" ? true
    : ins.tier === "noise" ? false
    : prev?.graduated ?? prev?.tier === "strong"
  return { delta: ins.delta, confident: ins.confident, tier: ins.tier, graduated }
}

/** Whether today's reading is a first climb to Solid worth announcing. Never on first sight. */
export function graduatedNow(ins: Observed, prev: WatchEntry | undefined): boolean {
  return prev?.tier != null && prev.tier !== "strong" && !prev.graduated && ins.tier === "strong"
}
/**
 * One event, two surfaces, two sentences — because only one of them can be
 * tapped.
 *
 * The push notification is tappable: its url opens the insights page, so
 * "tap to see" is an instruction that works. The SAME string then went to
 * sayAsEmergy and became a chat bubble, where it is plain text in a
 * conversation — there is nothing to tap, and a person poking at it gets
 * nothing. A promise the surface cannot keep, sitting in the product for
 * anyone to screenshot, which is exactly how it was found.
 *
 * So the chat body says the news instead of teasing it: the first finding in
 * full — a chat bubble has room the notification shade does not — and an
 * honest pointer at the insights page for the rest. sayAsEmergy caps at
 * SAY_MAX_LEN and flattens whitespace, so the first finding plus the pointer
 * is the most that reliably survives.
 */
export function watchBodies(changes: Change[]): { push: string; chat: string } {
  const first = changes[0]
  const headline = `${first.reason === "is now a solid pattern"
    ? "New solid pattern"
    : "A pattern you're watching " + first.reason}: ${first.finding}`

  if (changes.length === 1) return { push: headline, chat: headline }
  return {
    push: `${changes.length} patterns changed — tap to see.`,
    chat: `${changes.length} patterns changed. One of them ${first.reason === "is now a solid pattern"
      ? "is solid now"
      : first.reason}: ${first.finding.replace(/[.\s]*$/, "")}. Ask me what else moved.`,
  }
}
