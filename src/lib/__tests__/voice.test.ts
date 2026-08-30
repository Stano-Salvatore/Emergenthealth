import { describe, it, expect, vi } from "vitest"

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }))
vi.mock("@capacitor-community/speech-recognition", () => ({ SpeechRecognition: {} }))

import { resolveVoice, speakableText } from "@/lib/voice"

const v = (voiceURI: string, lang: string, isDefault = false) =>
  ({ voiceURI, lang, name: voiceURI, default: isDefault, localService: true }) as SpeechSynthesisVoice

describe("resolveVoice", () => {
  const voices = [v("en-GB-1", "en-GB"), v("sk-SK-1", "sk-SK"), v("en-US-1", "en-US", true)]

  it("uses the voice chosen on this device", () => {
    expect(resolveVoice(voices, "sk-SK-1", "en-US")?.voiceURI).toBe("sk-SK-1")
  })

  it("falls back to the language when the saved voice is gone", () => {
    // Voices come and go with system updates: a saved name is a preference,
    // never a guarantee, so a missing one must not silence Emergy.
    expect(resolveVoice(voices, "deleted-voice", "sk-SK")?.voiceURI).toBe("sk-SK-1")
  })

  it("prefers the language default, then any match, then the system default", () => {
    expect(resolveVoice(voices, null, "en-US")?.voiceURI).toBe("en-US-1")
    expect(resolveVoice(voices, null, "en-GB")?.voiceURI).toBe("en-GB-1")
    expect(resolveVoice(voices, null, "fr-FR")?.voiceURI).toBe("en-US-1")
  })

  it("has nothing to say when the device has no voices", () => {
    expect(resolveVoice([], "x", "en")).toBeNull()
  })
})

describe("speakableText", () => {
  it("strips markdown that would be read as punctuation soup", () => {
    expect(speakableText("**Sleep** was `7.2h` — see [Insights](/dashboard/insights)"))
      .toBe("Sleep was 7.2h — see Insights")
    expect(speakableText("## Heading\n- point one")).toBe("Heading point one")
  })

  it("drops emoji and code blocks", () => {
    expect(speakableText("Nice work 🎉")).toBe("Nice work")
    expect(speakableText("before\n```js\nconst x = 1\n```\nafter")).toBe("before after")
  })
})

describe("speak — noticing when the device only pretends", () => {
  // speechSynthesis.speak() queues an utterance and reports nothing back. On a
  // platform with no working engine — an Android WebView with no TTS service
  // bound is the case that prompted this — it is accepted and never spoken:
  // onstart never fires, onend never fires, and a caller that trusted the
  // queue lights a speaker icon over silence for ever.
  class FakeUtterance {
    text: string
    voice: unknown = null
    lang = ""
    rate = 1
    onstart: (() => void) | null = null
    onend: (() => void) | null = null
    onerror: ((e: { error: string }) => void) | null = null
    constructor(text: string) { this.text = text }
  }

  function withSynth(behaviour: "speaks" | "silent" | "fails" | "cancelled") {
    const spoken: FakeUtterance[] = []
    const synth = {
      getVoices: () => [],
      cancel: vi.fn(),
      speak: (u: FakeUtterance) => {
        spoken.push(u)
        if (behaviour === "speaks") u.onstart?.()
        // The engine refusing, promptly — what headless Chromium actually does,
        // and what an Android WebView with no TTS service bound may do.
        if (behaviour === "fails") u.onerror?.({ error: "synthesis-failed" })
        if (behaviour === "cancelled") u.onerror?.({ error: "canceled" })
      },
    }
    vi.stubGlobal("window", { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance })
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance)
    return { spoken, synth }
  }

  it("reports silence when nothing ever starts", async () => {
    vi.useFakeTimers()
    const { synth } = withSynth("silent")
    const { speak, SPEECH_START_TIMEOUT_MS } = await import("@/lib/voice")

    const onSilent = vi.fn()
    const onStart = vi.fn()
    expect(speak("hello there", { onStart, onSilent })).toBe(true)

    expect(onSilent).not.toHaveBeenCalled()
    vi.advanceTimersByTime(SPEECH_START_TIMEOUT_MS + 10)
    expect(onSilent).toHaveBeenCalledTimes(1)
    expect(onStart).not.toHaveBeenCalled()
    // The dead utterance is cleared, or it would play later over whatever is
    // being said by then: once on entry, once by the watchdog.
    expect(synth.cancel).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("does not cry silence when the device does speak", async () => {
    vi.useFakeTimers()
    withSynth("speaks")
    const { speak, SPEECH_START_TIMEOUT_MS } = await import("@/lib/voice")

    const onSilent = vi.fn()
    const onStart = vi.fn()
    speak("hello there", { onStart, onSilent })

    expect(onStart).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(SPEECH_START_TIMEOUT_MS * 2)
    expect(onSilent).not.toHaveBeenCalled()

    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("has nothing to say about text that is only emoji and markdown", async () => {
    withSynth("speaks")
    const { speak } = await import("@/lib/voice")
    expect(speak("**** 🌱🌱", {})).toBe(false)
    expect(speak("   ", {})).toBe(false)
    vi.unstubAllGlobals()
  })
})

describe("speak — an engine that refuses outright", () => {
  class FakeUtterance {
    text: string
    voice: unknown = null
    lang = ""
    rate = 1
    onstart: (() => void) | null = null
    onend: (() => void) | null = null
    onerror: ((e: { error: string }) => void) | null = null
    constructor(text: string) { this.text = text }
  }

  /** An engine that answers immediately with `error` instead of speaking. */
  function refusingSynth(error: string) {
    vi.stubGlobal("window", {
      speechSynthesis: {
        getVoices: () => [],
        cancel: () => {},
        speak: (u: FakeUtterance) => u.onerror?.({ error }),
      },
      SpeechSynthesisUtterance: FakeUtterance,
    })
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance)
  }

  it("reports a synthesis failure rather than treating it as a finished reply", async () => {
    // The watchdog alone misses this: the error arrives in milliseconds, well
    // inside the timeout, so mapping onerror straight to onEnd cleared the
    // watchdog and looked like a normal finish — the icon went dark over
    // silence and nothing said why. Headless Chromium does exactly this.
    refusingSynth("synthesis-failed")
    const { speak } = await import("@/lib/voice")
    const onSilent = vi.fn(); const onEnd = vi.fn()
    speak("hello there", { onEnd, onSilent })
    expect(onSilent).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it("stays quiet when the error is our own cancel", async () => {
    // stopSpeaking(), or the cancel() at the top of the next utterance. Saying
    // "your device cannot speak" every time the user hits stop would train
    // them to ignore the one time it is true.
    refusingSynth("canceled")
    const { speak } = await import("@/lib/voice")
    const onSilent = vi.fn(); const onEnd = vi.fn()
    speak("hello there", { onEnd, onSilent })
    expect(onSilent).not.toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
