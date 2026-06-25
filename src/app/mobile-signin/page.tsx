import { redirect } from "next/navigation"

// Chrome Custom Tab opens this URL. We immediately redirect to the Route
// Handler that initiates Google OAuth via a plain HTTP response (not a Server
// Action), so Set-Cookie headers reach Chrome's cookie jar correctly.
export default async function MobileSignIn({
  searchParams,
}: {
  searchParams: Promise<{ auth_key?: string }>
}) {
  const sp = await searchParams
  const authKey = sp.auth_key ?? ""
  redirect(`/api/mobile-auth-start?auth_key=${encodeURIComponent(authKey)}`)
}
