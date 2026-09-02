import { distanceM } from "@/lib/places"

// Where the day was actually spent, as opposed to the line it traced.
//
// A route drawn on its own answers "which way did I go" and nothing else — an
// afternoon in one café and an afternoon of errands can draw the same shape.
// What a day map is really being asked is where you STOPPED and for how long,
// so that is what this finds.
//
// Deliberately NOT lib/place-visits: that decides when a stay is worth writing
// a check-in for, and only ever inside somewhere you saved. This describes the
// day as it happened, saved place or not, and is what the map draws.

/** Points this close together are the same stop, not travel between two. */
const STOP_RADIUS_M = 120

/**
 * Ten minutes, where a check-in needs twenty.
 *
 * The thresholds differ because the questions do. Logging a visit should be
 * sure — twenty minutes says you were THERE rather than passing. Drawing the
 * day only has to be interesting, and a ten-minute stop at the bakery is
 * exactly the sort of thing you want to see on a map of your own afternoon.
 */
const STOP_MIN_MIN = 10

/**
 * A silence longer than this ends the stop rather than extending it.
 *
 * Tracking pauses when the phone is off, out of signal, or the app was killed.
 * Bridging that gap would report a stay that covers hours nobody observed.
 */
const STOP_MAX_GAP_MIN = 60

export interface TimedPoint {
  lat: number
  lon: number
  time: Date
}

export interface Stop {
  /** The middle of the cluster, not its first fix. */
  lat: number
  lon: number
  start: Date
  end: Date
  minutes: number
  points: number
}

/**
 * Stops in the order they happened.
 *
 * Points must be sorted by time. A cluster grows while each new fix stays
 * within STOP_RADIUS_M of the cluster's running centre — the centre, not the
 * first fix, so a stay does not drift a whole radius across an afternoon and
 * quietly absorb the shop next door.
 */
export function detectStops(points: TimedPoint[]): Stop[] {
  const stops: Stop[] = []
  if (points.length < 2) return stops

  let cluster: TimedPoint[] = []
  let sumLat = 0
  let sumLon = 0

  const close = () => {
    if (cluster.length >= 2) {
      const start = cluster[0].time
      const end = cluster[cluster.length - 1].time
      const minutes = (end.getTime() - start.getTime()) / 60_000
      if (minutes >= STOP_MIN_MIN) {
        stops.push({
          lat: sumLat / cluster.length,
          lon: sumLon / cluster.length,
          start,
          end,
          minutes: Math.round(minutes),
          points: cluster.length,
        })
      }
    }
    cluster = []
    sumLat = 0
    sumLon = 0
  }

  for (const p of points) {
    if (cluster.length === 0) {
      cluster = [p]
      sumLat = p.lat
      sumLon = p.lon
      continue
    }

    const gapMin = (p.time.getTime() - cluster[cluster.length - 1].time.getTime()) / 60_000
    const centreLat = sumLat / cluster.length
    const centreLon = sumLon / cluster.length
    const near = distanceM(centreLat, centreLon, p.lat, p.lon) <= STOP_RADIUS_M

    if (near && gapMin <= STOP_MAX_GAP_MIN) {
      cluster.push(p)
      sumLat += p.lat
      sumLon += p.lon
      continue
    }

    close()
    cluster = [p]
    sumLat = p.lat
    sumLon = p.lon
  }
  close()

  return stops
}

export { STOP_RADIUS_M, STOP_MIN_MIN, STOP_MAX_GAP_MIN }

/**
 * Below this, a hop between two fixes is noise rather than travel.
 *
 * A stationary phone still reports a slightly different position every time,
 * and summing those differences counts standing still as walking. It used to
 * be a rounding error because points arrived rarely; the app's own tracking
 * takes a fix every five minutes and never filters by distance, so a day at a
 * desk now accrues hundreds of phantom metres — a quarter of this day's
 * reported distance was jitter.
 *
 * Twenty-five metres is roughly twice a good urban fix's accuracy: under it,
 * nothing can be distinguished from having not moved.
 */
const NOISE_FLOOR_M = 25

/** Above this a leg is a bad fix, not a record. */
const IMPLAUSIBLE_KMH = 300

/**
 * Distance, moving time and top speed in ONE pass over the same segments.
 *
 * Computed together because computed apart they disagreed. Distance summed
 * every hop while moving time was the day minus its stops, so the two counted
 * different spans — and the day's average came out FASTER than its quickest
 * leg, which is impossible and was on screen. Deriving all three from the
 * segments that actually moved makes the average a weighted mean of segment
 * speeds, so it cannot exceed the maximum however the day went.
 *
 * Legs inside a detected stop are skipped outright, and that is the part that
 * actually works. A fixed noise floor is guesswork — jitter swinging ±14 m
 * puts consecutive fixes 28 m apart and clears a 25 m floor — whereas a stop
 * is a measurement: it says the phone did not go anywhere between these two
 * times, so whatever distance the fixes suggest in that window is error. The
 * floor stays for the legs in between, where there is nothing better.
 */
export function summariseTrack(pts: TimedPoint[], stops: Stop[] = []): {
  distanceKm: number
  movingMin: number
  maxSpeedKmh: number
} {
  let metres = 0
  let movingSeconds = 0
  let maxSpeedKmh = 0

  const insideAStop = (a: Date, b: Date) =>
    stops.some(st => a.getTime() >= st.start.getTime() && b.getTime() <= st.end.getTime())

  for (let i = 1; i < pts.length; i++) {
    const seconds = (pts[i].time.getTime() - pts[i - 1].time.getTime()) / 1000
    if (seconds <= 0) continue
    if (insideAStop(pts[i - 1].time, pts[i].time)) continue
    const leg = distanceM(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon)
    if (leg < NOISE_FLOOR_M) continue

    const kmh = (leg / seconds) * 3.6
    // Dropped, not clamped: clamping would present a wild fix as a real record.
    if (kmh > IMPLAUSIBLE_KMH) continue

    metres += leg
    movingSeconds += seconds
    if (kmh > maxSpeedKmh) maxSpeedKmh = kmh
  }

  return { distanceKm: metres / 1000, movingMin: movingSeconds / 60, maxSpeedKmh }
}
