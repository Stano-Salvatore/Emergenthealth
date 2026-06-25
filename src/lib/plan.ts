import { prisma } from "@/lib/prisma"

export type Plan = "free" | "pro"

export async function getUserPlan(userId: string): Promise<Plan> {
  const sub = await prisma.subscription.findUnique({
    where: { userId },
    select: { status: true, currentPeriodEnd: true },
  }).catch(() => null)

  if (!sub) return "free"
  if (sub.status === "active" || sub.status === "trialing") return "pro"
  if (sub.status === "past_due") return "pro" // grace period
  return "free"
}

export async function isPro(userId: string): Promise<boolean> {
  return (await getUserPlan(userId)) === "pro"
}

export const PRO_FEATURES = {
  unlimitedHabits: "Unlimited habits (free: 10)",
  fullHistory: "Full history (free: 30 days)",
  dailyAiInsights: "Daily AI insights (free: weekly)",
  bankSync: "Bank & finance sync",
  dataExport: "Data export (CSV, JSON)",
  customWidgets: "Custom home screen widgets",
  emailDigest: "Daily email digest",
  prioritySync: "Priority background sync",
} as const
