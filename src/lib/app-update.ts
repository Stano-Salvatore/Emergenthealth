// Is the APK on this phone behind the one CI last published?
//
// Play handles updates in production, but closed testers and sideloads do not
// get them, and a phone sat on build 1008 for days while 1051 waited. This
// is the comparison, kept pure so it can be tested without a phone.

export type UpdateVerdict =
  /** Phone is on the newest build. */
  | { status: "current"; installed: number; latest: number }
  /** A newer build exists. `installed` is null when the APK predates the
   *  build stamp — older than every stamped build, so behind by definition. */
  | { status: "behind"; installed: number | null; latest: number }
  /** The server could not say what the latest build is. */
  | { status: "unknown-latest"; installed: number | null }

export function judgeUpdate(installed: number | null, latest: number | null): UpdateVerdict {
  if (latest == null) return { status: "unknown-latest", installed }
  if (installed == null || installed < latest) return { status: "behind", installed, latest }
  return { status: "current", installed, latest }
}

/** The versionCode the release notes carry, or null when they don't. */
export function parseVersionCode(notes: string | null | undefined): number | null {
  const m = /versionCode\s+(\d+)/.exec(notes ?? "")
  return m ? Number(m[1]) : null
}
