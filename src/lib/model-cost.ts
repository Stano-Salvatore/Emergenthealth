// What a model turn actually cost, in dollars.
//
// `EMERGY_CHAT_EFFORT` exists to be stepped down and measured, and the per-turn
// log line already prints the four token counts the answer depends on. Tokens
// are not the answer, though: input and output are priced five times apart, a
// cache write costs more than an uncached read and a cache hit costs a tenth,
// so four numbers that all moved leave you doing arithmetic in a log viewer.
// This turns them into the one number the knob is being judged on.
//
// The prices are per million tokens, from Anthropic's pricing page. They are
// the one thing here that can go stale without anything failing, so they are
// listed plainly rather than buried in a formula.

import { OPUS, SONNET, HAIKU } from "@/lib/models"

const PER_MILLION: Record<string, { input: number; output: number }> = {
  [OPUS]: { input: 5, output: 25 },
  [SONNET]: { input: 2, output: 10 },
  [HAIKU]: { input: 1, output: 5 },
}

/** A cache write costs more than a plain read; a cache hit costs a tenth. */
const CACHE_WRITE = 1.25
const CACHE_READ = 0.1

/** The token counts every Messages response carries. */
export interface TurnUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

/**
 * Dollars for one turn, or null for a model this file has no price for —
 * null rather than zero, because a free turn and an unknown one are different
 * facts and only one of them should be summed.
 *
 * Four decimal places, because a chat turn costs cents and two would round
 * most of them to the same number.
 */
export function turnCostUsd(model: string, usage: TurnUsage): number | null {
  const price = PER_MILLION[model]
  if (!price) return null
  const read = usage.cache_read_input_tokens ?? 0
  const write = usage.cache_creation_input_tokens ?? 0
  const input = usage.input_tokens + write * CACHE_WRITE + read * CACHE_READ
  const dollars = (input * price.input + usage.output_tokens * price.output) / 1_000_000
  return Number(dollars.toFixed(4))
}
