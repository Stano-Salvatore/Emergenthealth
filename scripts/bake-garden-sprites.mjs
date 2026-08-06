#!/usr/bin/env node
// Bakes the hand-drawn SVG garden sprites (assets-src/garden/*.svg) into
// transparent PNGs at exactly 2x the engine's display size, written to
// public/garden-assets/<key>.png. The Pixi engine prefers these PNGs over its
// emoji fallbacks (see src/components/garden/engine.ts).
//
// Requires playwright-core + a chromium binary:
//   npm i -D playwright-core   (or set NODE_PATH to a tree that has it)
//   CHROMIUM=/path/to/chromium node scripts/bake-garden-sprites.mjs

import { readdir, readFile, mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { chromium } = require("playwright-core")

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SRC = path.join(root, "assets-src/garden")
const OUT = path.join(root, "public/garden-assets")

// Display heights (px) — keep in sync with SPRITE_DEFS in engine.ts
const SIZES = {
  tree_oak: 84, tree_pine: 80, house: 72, shelf: 60, lantern: 40, lily: 34,
  teapot: 30, basket: 34, candle: 26, potted: 38, gnome: 44, bird: 32,
  stone: 30, mushroom: 30, ladybug: 22, snail: 24, frog: 32, fox: 36,
  hedgehog: 30, butterfly: 30, bee: 26, rainbow: 60, bloom: 34,
}
const SCALE = 2 // bake at 2x for crisp rendering; engine normalizes by height

const files = (await readdir(SRC)).filter(f => f.endsWith(".svg"))
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium",
})
const page = await browser.newPage()

for (const file of files) {
  const key = file.replace(/\.svg$/, "")
  const size = SIZES[key]
  if (!size) { console.warn(`skip ${file}: no size defined`); continue }
  const svg = await readFile(path.join(SRC, file), "utf8")
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  if (!vb) { console.warn(`skip ${file}: no viewBox`); continue }
  const [w, h] = [parseFloat(vb[1]), parseFloat(vb[2])]
  const outH = Math.round(size * SCALE)
  const outW = Math.round(outH * (w / h))
  await page.setViewportSize({ width: outW, height: outH })
  await page.setContent(
    `<style>*{margin:0}body{background:transparent}</style>` +
    svg.replace("<svg ", `<svg width="${outW}" height="${outH}" `),
  )
  await page.locator("svg").screenshot({ path: path.join(OUT, `${key}.png`), omitBackground: true })
  console.log(`baked ${key}.png ${outW}x${outH}`)
}

await browser.close()
console.log(`done: ${files.length} sprites -> public/garden-assets/`)
