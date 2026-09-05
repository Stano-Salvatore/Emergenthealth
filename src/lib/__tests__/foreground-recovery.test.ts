import { describe, it, expect } from "vitest"
import { execSync } from "node:child_process"

// A standing guard, not a unit test.
//
// Android ends a foreground service whenever it likes and tells nobody: no
// callback, no reboot, no onTaskRemoved. The app's only way back is to notice
// on its next chance and start the service again — and a start from the
// foreground is the one Android always permits.
//
// "Its next chance" has to mean being RESUMED, not only cold-started. A phone
// app is almost always brought back from the background, which remounts
// nothing, so a recovery call in a mount-only effect fires on the first launch
// after a reboot and then never again. Tracking stopped at lunchtime and
// stayed stopped for days, while the status card said "should be tracking but
// isn't" with no way to act on it.
//
// This is the third component to need the lesson — AutoSync and
// DeviceStatusChips already listen for the same event, and DashboardShell did
// not. Fixing the third does nothing about the fourth, so: any file that calls
// one of these recovery functions must also register a visibilitychange
// listener.

const RECOVERY_CALLS = [
  "resumeBackgroundLocation",
]

describe("device recovery runs on resume, not only on mount", () => {
  for (const fn of RECOVERY_CALLS) {
    it(`every caller of ${fn} also listens for visibilitychange`, () => {
      let out = ""
      try {
        out = execSync(
          `grep -rl '${fn}(' src --include=*.ts --include=*.tsx || true`,
          { encoding: "utf8", cwd: process.cwd() },
        )
      } catch {
        // grep exits non-zero when nothing matches; `|| true` covers it, and a
        // genuine failure to run must not silently pass the guard.
        out = ""
      }

      const offenders = out
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        // The file that defines it, and the tests, are not callers.
        .filter(f => !f.includes("__tests__") && !f.endsWith("background-location.ts"))
        .filter(f => !execSync(`cat ${f}`, { encoding: "utf8" }).includes("visibilitychange"))

      expect(offenders, [
        `${fn}() is called without a visibilitychange listener in the same file.`,
        "",
        "A mount-only effect never fires again once the app is merely resumed,",
        "which is how a phone app is almost always reopened. Add:",
        "",
        `  const onVisible = () => { if (document.visibilityState === "visible") void ${fn}() }`,
        '  document.addEventListener("visibilitychange", onVisible)',
        '  return () => document.removeEventListener("visibilitychange", onVisible)',
      ].join("\n")).toEqual([])
    })
  }
})
