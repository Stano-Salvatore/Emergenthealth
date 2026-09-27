import { isFeatureEnabled } from "@/lib/features"

// eWeLink, Tuya, EWPE and the Rowenta bridge sign in with credentials from
// this deployment's environment: they are the owner's accounts and devices,
// not per-user connections. Only the owner may reach them, and only while
// smart home is switched on for this deployment.
export function isHomeOwner(email: string | null | undefined): boolean {
  const owner = (process.env.FEEDBACK_NOTIFY_EMAIL ?? process.env.OWNER_EMAIL)?.trim().toLowerCase()
  return isFeatureEnabled("smarthome") && !!owner && !!email && email.trim().toLowerCase() === owner
}
