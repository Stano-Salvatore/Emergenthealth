// Shifts this process's clock so that "now" is FAKE_NOW (an ISO instant) at
// start-up, and keeps ticking from there. Loaded into `next dev` through
// NODE_OPTIONS=--require so Turbopack's workers inherit it:
//
//   FAKE_NOW=2026-09-22T22:30:00Z NODE_OPTIONS=--require=./.ci/fake-clock.cjs npm run dev
//
// The reason to want it: three of the six bug shapes this codebase keeps
// finding only show at 00:30 local. A server component on Vercel decides
// "today" in UTC, the Check-in tab picks its mode from the hour, the Week
// page draws its week from Monday — and none of that can be seen at the hour
// anyone runs a smoke test. `.ci/render-at.mjs` shifts the browser the same
// way, so both halves of the app believe the same wrong time.
const target = process.env.FAKE_NOW
if (target) {
  const RealDate = Date
  const offset = new RealDate(target).getTime() - RealDate.now()
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset)
      else super(...args)
    }
    static now() { return RealDate.now() + offset }
  }
  FakeDate.UTC = RealDate.UTC
  FakeDate.parse = RealDate.parse
  globalThis.Date = FakeDate
}
