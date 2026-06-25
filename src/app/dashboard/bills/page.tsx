import type { Metadata } from "next"
import { auth } from "@/auth"
import { getBillEmails } from "@/lib/gmail"
import { Mail, AlertCircle } from "lucide-react"

export const metadata: Metadata = { title: "Bills" }

export default async function BillsPage() {
  const session = await auth()
  if (!session?.user?.id) return null
  const userId = session.user.id

  const bills = await getBillEmails(userId).catch(() => [])

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Bills</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Upcoming bills detected from your Gmail inbox
        </p>
      </div>

      {bills.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Mail className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm mb-1">No bills detected</p>
          <p className="text-xs text-muted-foreground/60">
            Bills are detected from your Gmail inbox. Make sure Gmail is connected in{" "}
            <a href="/dashboard/settings" className="text-primary hover:underline">Settings</a>.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="divide-y divide-border/50">
            {bills.map((bill, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{(bill as { subject?: string }).subject ?? "Bill"}</p>
                  <p className="text-xs text-muted-foreground">
                    {(bill as { from?: string }).from ?? ""}
                    {(bill as { date?: string }).date ? ` · ${(bill as { date?: string }).date}` : ""}
                  </p>
                </div>
                {(bill as { amount?: string }).amount && (
                  <p className="text-sm font-semibold shrink-0">{(bill as { amount?: string }).amount}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
