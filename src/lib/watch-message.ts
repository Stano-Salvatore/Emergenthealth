export type Change = { finding: string; reason: string }
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
      : first.reason}: ${first.finding.replace(/[.\s]*$/, "")}. The rest are on your insights page.`,
  }
}
