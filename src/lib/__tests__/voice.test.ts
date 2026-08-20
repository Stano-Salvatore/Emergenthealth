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
