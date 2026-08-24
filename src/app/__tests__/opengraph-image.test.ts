import { describe, it, expect } from "vitest"
import OGImage from "../opengraph-image"

// The social preview card, rendered for real.
//
// Satori — what next/og uses — refuses to render a div with more than one
// child unless its display is explicit, and it refuses the entire image rather
// than just that element. This card failed on every request from June until it
// turned up in the production logs. Nothing in the build, the types or the
// tests noticed, because the only thing that can tell is a renderer.
//
// So this test runs one. If the layout drifts back into a shape satori
// rejects, this fails instead of the card quietly vanishing from every link
// anyone shares.

describe("opengraph-image", () => {
  it("renders to a PNG", async () => {
    const bytes = new Uint8Array(await OGImage().arrayBuffer())
    expect(bytes.length).toBeGreaterThan(1000)
    // PNG magic number: an error page with a body would otherwise pass.
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
  }, 60_000)
})
