import type { Metadata } from "next"
import { auth } from "@/auth"
import { BriefView } from "@/components/dashboard/BriefView"

export const metadata: Metadata = { title: "Brief" }

export default async function BriefPage() {
  const session = await auth()
  const name = session?.user?.name?.split(" ")[0] ?? "there"
  return <BriefView name={name} />
}
