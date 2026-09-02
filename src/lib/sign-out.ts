"use client"

import { signOut } from "next-auth/react"

/**
 * Sign out and take the offline copy with you.
 *
 * The service worker keeps the last dashboard, today's numbers and recent API
 * responses so the app opens without a connection. Signing out cleared the
 * session cookie and nothing else, so on a shared device the next person to
 * open the app still saw the previous user's cached pages until the network
 * replaced them. The caches go first; the sign-out follows either way.
 */
export async function signOutAndForget(callbackUrl = "/signin"): Promise<void> {
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
  } catch {
    // A browser without CacheStorage, or a denied storage permission — sign out anyway.
  }
  await signOut({ callbackUrl })
}
