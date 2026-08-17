export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Which build is this server actually running? The native app is a thin shell
// loading remote code, so "the APK is current" and "the deploy is current" can
// both be true while a phone still runs something else entirely — this is the
// reference point those checks compare against. Public by design: a commit sha
// identifies a build without revealing anything in it.
export async function GET() {
  return Response.json(
    {
      sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      // What the client bundle sees inlined — null here means the Vercel
      // project isn't exposing system env vars, and the Settings card's
      // "web build" line will read "sha unavailable" for that reason.
      clientSha: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? null,
      env: process.env.VERCEL_ENV ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
