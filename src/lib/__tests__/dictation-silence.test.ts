import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// The web dictation path, driven by a fake recognizer.
//
// The point of the test is the SILENCE BACKSTOP: dictation that finishes
// itself after a long pause and tells the caller it was silence, not a tap,
// because only one of those means "send it". A real microphone cannot be
// asked to go quiet on cue, so the recognizer is stubbed and the clock is
// faked — which is also the only way to assert on a six-second wait without
// a six-second test.

class FakeRecognition {
  lang = ""
  continuous = false
  interimResults = false
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onend: (() => void) | null = null
  started = false
  stopped = false
  start() { this.started = true }
  stop() { this.stopped = true; this.onend?.() }
  /** Pretend the user said something. */
  say(text: string) {
    this.onresult?.({ results: [[{ transcript: text }]], length: 1 })
  }
}

let fake: FakeRecognition

beforeEach(() => {
  vi.useFakeTimers()
  fake = new FakeRecognition()
  // @ts-expect-error – standing in for the browser API
  globalThis.window = globalThis
  // @ts-expect-error – ditto
  globalThis.SpeechRecognition = function () { return fake }
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  // Both globals go back, not just the recognizer. Leaving `window` defined
  // in a node environment makes every later test in the run think it is in a
  // browser, which is the kind of order-dependent flake that takes an
  // afternoon to find.
  // @ts-expect-error – cleaning the globals back up
  delete globalThis.SpeechRecognition
  // @ts-expect-error – ditto
  delete globalThis.window
})

type StartOpts = Parameters<typeof import("@/lib/voice").startDictation>[0]

async function start(opts: Omit<StartOpts, "lang">) {
  const { startDictation } = await import("@/lib/voice")
  // lang passed explicitly: navigator is read-only in Node, and the locale
  // is irrelevant to what these tests are about.
  return startDictation({ lang: "en-GB", ...opts })
}

describe("dictation silence backstop", () => {
  it("finishes by itself after the quiet gap, and says it was silence", async () => {
    const onFinal = vi.fn()
    await start({ silenceMs: 6000, onFinal, onError: vi.fn() })
    fake.say("log a glass of water")

    await vi.advanceTimersByTimeAsync(5000)
    expect(onFinal).not.toHaveBeenCalled()   // still within the pause

    await vi.advanceTimersByTimeAsync(1500)
    expect(onFinal).toHaveBeenCalledWith("log a glass of water", "silence")
  })

  it("restarts the clock on every word, so a slow sentence is not cut off", async () => {
    const onFinal = vi.fn()
    await start({ silenceMs: 6000, onFinal, onError: vi.fn() })

    // Four seconds of quiet, another word, four more: eight seconds in total
    // and it must NOT have fired, because the longest gap was only four.
    fake.say("log")
    await vi.advanceTimersByTimeAsync(4000)
    fake.say("log a glass")
    await vi.advanceTimersByTimeAsync(4000)
    expect(onFinal).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2500)
    expect(onFinal).toHaveBeenCalledWith("log a glass", "silence")
  })

  it("counts down only the last three seconds", async () => {
    const onSilenceTick = vi.fn()
    await start({ silenceMs: 6000, onFinal: vi.fn(), onError: vi.fn(), onSilenceTick })
    fake.say("hello")

    // Nothing announced while there is still plenty of time to carry on.
    await vi.advanceTimersByTimeAsync(2000)
    expect(onSilenceTick).not.toHaveBeenCalled()

    // Then the tail: three seconds left, two, one.
    await vi.advanceTimersByTimeAsync(1000)
    expect(onSilenceTick).toHaveBeenLastCalledWith(3)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onSilenceTick).toHaveBeenLastCalledWith(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onSilenceTick).toHaveBeenLastCalledWith(1)
  })

  it("stays out of the way when no backstop is asked for", async () => {
    const onFinal = vi.fn()
    await start({ onFinal, onError: vi.fn() })   // no silenceMs
    fake.say("something")
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onFinal).not.toHaveBeenCalled()
  })

  it("stops the clock when the user stops it by hand", async () => {
    const onFinal = vi.fn()
    const handle = await start({ silenceMs: 6000, onFinal, onError: vi.fn() })
    fake.say("half a thought")
    handle?.stop()
    await vi.advanceTimersByTimeAsync(20_000)
    // Stopping by hand must not later fire a second, silence-flavoured finish
    // — that would send a message the user had just cancelled.
    expect(onFinal).not.toHaveBeenCalledWith("half a thought", "silence")
  })
})
