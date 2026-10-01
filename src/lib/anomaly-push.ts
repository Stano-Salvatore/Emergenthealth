// What the anomaly watch says, once it has decided something is worth saying.
// The decision — new, worsened, or a week since — stays in the cron route;
// this only picks the words.

import { nightQuestion, type Anomaly } from "@/lib/anomalies"
import type { BodyStrain } from "@/lib/body-strain"

/** Two at once is a signal; five at once is noise. */
const MAX_PER_PUSH = 2

export interface AnomalyPush {
  title: string
  body: string
  url: string
  /** The night question goes out as one, so a reply answers one night. */
  question: boolean
}

export function anomalyPush(worth: Anomaly[], strain: BodyStrain | null): AnomalyPush | null {
  if (worth.length === 0) return null

  // A night question goes out on its own, so the reply is unambiguous:
  // "two beers with Peter" answers one night, not a list of three metrics.
  const question = worth.map(nightQuestion).find((q): q is string => q != null)
  if (question) {
    const a = worth.find(x => nightQuestion(x) === question)!
    return { title: `${a.emoji} About last night`, body: question, url: "/dashboard/chat", question: true }
  }

  // Major strain says the night in one sentence instead of two metric lines —
  // but only when something new in it is why this push is going out, so a
  // run the watch already mentioned does not come back reworded. The
  // infection composite already speaks for its own night.
  if (strain?.level === "major" && !strain.illness && worth.some(a => strain.signs.some(s => s.metric === a.metric))) {
    return { title: `🧭 ${strain.headline}`, body: strain.summary, url: "/dashboard", question: false }
  }

  const top = worth.slice(0, MAX_PER_PUSH)
  const body = top.map(a => a.summary).join(" · ")
    + (worth.length > top.length ? ` · +${worth.length - top.length} more` : "")
  return { title: `${top[0].emoji} Off your baseline`, body, url: "/dashboard/insights", question: false }
}
