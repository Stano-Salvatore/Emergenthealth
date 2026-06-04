import { redirect } from "next/navigation"

interface Props {
  params: Promise<{ code: string }>
}

export default async function InvitePage({ params }: Props) {
  const { code } = await params
  // Store code in query param, handled client-side in signin
  redirect(`/signin?ref=${encodeURIComponent(code)}`)
}
