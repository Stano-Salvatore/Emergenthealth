// Closing the morning's intention from the evening. One writer, so the
// check-in screen, the API and Emergy's tool cannot disagree about what an
// answer is or which row it lands on.

import { prisma } from "@/lib/prisma"
import { INTENTION_OUTCOMES, type IntentionOutcome } from "@/lib/checkin-mode"

export function parseOutcome(raw: unknown): IntentionOutcome | null {
  const v = String(raw ?? "").trim().toLowerCase()
  return (INTENTION_OUTCOMES as readonly string[]).includes(v) ? v as IntentionOutcome : null
}

/**
 * Record how the intention set on `date` went. Only a row that HAD an
 * intention takes an answer — "done" against a morning that set nothing is
 * not data. Returns false when there was nothing to close.
 */
export async function closeIntention(userId: string, date: string, outcome: IntentionOutcome, note: string | null): Promise<boolean> {
  const updated = await prisma.morningCheckIn.updateMany({
    where: { userId, date, intention: { not: null } },
    data: { intentionOutcome: outcome, intentionNote: note?.trim() ? note.trim().slice(0, 500) : null },
  }).catch(() => ({ count: 0 }))
  return updated.count > 0
}
