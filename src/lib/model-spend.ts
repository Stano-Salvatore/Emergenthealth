// Writing down what a model call cost, whoever made it.
//
// The Console gives one number for the whole organisation. It says the bill is
// $8 this month; it cannot say whether that was chat, the weekly review, or one
// photographed lab printout. Six places in this app call the API, and until now
// only chat recorded anything — so the other five were invisible, and a 1.4M
// token week had no explanation in it.
//
// Every caller writes a row. The row carries the feature, the model and the
// effort, which is the set of things that actually move the number, and
// `model-cost.ts` turns the token counts into dollars. Fire and forget in every
// case: a failed insert must never cost the user the thing they asked for.

import { prisma } from "@/lib/prisma"
import { turnCostUsd, type TurnUsage } from "@/lib/model-cost"

/**
 * The parts of the app that spend money, named as a person would say them —
 * these strings are read back to the user, so they are labels, not symbols.
 */
export const TURN_FEATURES = [
  "chat",
  "briefing",
  "health report",
  "weekly review",
  "meal photo",
  "lab document",
] as const

export type TurnFeature = (typeof TURN_FEATURES)[number]

/**
 * Record one model turn. Never throws and never awaits anything the caller
 * needs: the point of the row is the next question about the bill, and no
 * answer should be delayed or lost for it.
 */
export function recordModelTurn(input: {
  userId: string
  model: string
  feature: TurnFeature
  /** What the request asked for, or null when it let the model decide. */
  effort?: string | null
  /** Index within one request; 0 unless a tool loop is running. */
  turn?: number
  stopReason?: string | null
  usage: TurnUsage
}): void {
  void prisma.modelTurn.create({
    data: {
      userId: input.userId,
      model: input.model,
      feature: input.feature,
      effort: input.effort ?? "default",
      turn: input.turn ?? 0,
      stopReason: input.stopReason ?? null,
      inputTokens: input.usage.input_tokens,
      outputTokens: input.usage.output_tokens,
      cacheReadTokens: input.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: input.usage.cache_creation_input_tokens ?? 0,
      costUsd: turnCostUsd(input.model, input.usage),
    },
  }).catch(() => {})
}
