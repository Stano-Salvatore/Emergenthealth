import { parseVersionCode } from "@/lib/app-update"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The rolling GitHub Release CI republishes on every main build. Public repo,
// public release: no token, and the notes carry the versionCode by design
// (see build-android.yml), so this is the one place the phone can learn what
// "latest" means without Play being involved.
const RELEASE_URL = "https://api.github.com/repos/stano-salvatore/emergenthealth/releases/tags/latest-android"
const RELEASE_CACHE_MS = 10 * 60 * 1000

export interface AndroidRelease {
  latestBuild: number
  publishedAt: string | null
  apkUrl: string | null
  releaseUrl: string
}

// Every phone asks on every app open; GitHub's unauthenticated limit is 60
// an hour per IP, and Vercel's egress shares IPs. One fetch per lambda per
// ten minutes keeps well clear of it. A failure is cached too — retrying a
// rate-limited call every second is how a limit gets worse.
let releaseCache: { at: number; value: AndroidRelease | null } | null = null

async function latestAndroidRelease(): Promise<AndroidRelease | null> {
  if (releaseCache && Date.now() - releaseCache.at < RELEASE_CACHE_MS) return releaseCache.value
  let value: AndroidRelease | null = null
  try {
    const res = await fetch(RELEASE_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "emergenthealth-update-check" },
      signal: AbortSignal.timeout(4000),
    })
    if (res.ok) {
      const rel = await res.json() as {
        body?: string; published_at?: string; html_url?: string
        assets?: { name: string; browser_download_url: string }[]
      }
      const latestBuild = parseVersionCode(rel.body)
      if (latestBuild != null) {
        value = {
          latestBuild,
          publishedAt: rel.published_at ?? null,
          apkUrl: rel.assets?.find(a => a.name.endsWith(".apk"))?.browser_download_url ?? null,
          releaseUrl: rel.html_url ?? "https://github.com/stano-salvatore/emergenthealth/releases/tag/latest-android",
        }
      }
    }
  } catch {
    // Unreachable GitHub is answered with android: null — the card says it
    // couldn't check rather than pretending the phone is current.
  }
  releaseCache = { at: Date.now(), value }
  return value
}

// Which build is this server actually running? The native app is a thin shell
// loading remote code, so "the APK is current" and "the deploy is current" can
// both be true while a phone still runs something else entirely — this is the
// reference point those checks compare against. Public by design: a commit sha
// identifies a build without revealing anything in it.
export async function GET() {
  const android = await latestAndroidRelease()
  return Response.json(
    {
      sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      // What the client bundle sees inlined — null here means the Vercel
      // project isn't exposing system env vars, and the Settings card's
      // "web build" line will read "sha unavailable" for that reason.
      clientSha: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? null,
      env: process.env.VERCEL_ENV ?? null,
      // The newest APK CI published, or null when GitHub couldn't be asked.
      android,
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
