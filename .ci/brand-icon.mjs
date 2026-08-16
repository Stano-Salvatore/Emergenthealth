// The Emergenthealth mark, in one place.
//
// The same artwork ends up in four different shapes with four different rules:
//
//   PWA icon            rounded square, drawn by us       (public/icon.svg)
//   Play listing icon   square, Play rounds the corners   (play-store/assets)
//   Adaptive launcher   two layers, outer 18dp croppable  (mipmap-anydpi-v26)
//   Themed launcher     single-colour silhouette          (monochrome layer)
//
// Keeping the geometry here means the pulse never drifts between them.

export const BG_FROM = "#312e81"
export const BG_TO = "#4f46e5"
export const PULSE_FROM = "#a5b4fc"
export const PULSE_TO = "#ffffff"

// Drawn on a 512-unit canvas. Spans x 48→464, y 160→352, centred on (256, 256).
const VIEW = 512
const POINTS = "48,256 148,256 178,160 208,352 238,210 262,302 286,256 464,256"
const STROKE = 36

// `scale` shrinks the pulse about the centre of the canvas. 1 is edge-to-edge;
// adaptive-icon foregrounds need it smaller so nothing important sits in the
// 18dp that launchers are free to crop.
function pulse(scale, stroke = `url(#pulse)`, width = STROKE) {
  const g = scale === 1
    ? ""
    : ` transform="translate(256,256) scale(${scale}) translate(-256,-256)"`
  return (
    `<g${g}>` +
    `<polyline points="${POINTS}" fill="none" stroke="${stroke}" ` +
    `stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</g>`
  )
}

const PULSE_GRADIENT =
  `<linearGradient id="pulse" x1="0%" y1="0%" x2="100%" y2="0%">` +
  `<stop offset="0%" stop-color="${PULSE_FROM}"/>` +
  `<stop offset="100%" stop-color="${PULSE_TO}"/>` +
  `</linearGradient>`

const BG_GRADIENT =
  `<linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">` +
  `<stop offset="0%" stop-color="${BG_FROM}"/>` +
  `<stop offset="100%" stop-color="${BG_TO}"/>` +
  `</linearGradient>`

function svg(body, defs) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" ` +
    `width="${VIEW}" height="${VIEW}">` +
    `<defs>${defs}</defs>${body}</svg>`
  )
}

// Full-bleed square. `radius` of 0 leaves the corners sharp — which is what
// Play Console wants, because Play applies its own mask and a pre-rounded
// source shows a visible double-rounded edge.
export function squareIcon({ radius = 0, scale = 1 } = {}) {
  return svg(
    `<rect width="${VIEW}" height="${VIEW}" rx="${radius}" fill="url(#bg)"/>` + pulse(scale),
    BG_GRADIENT + PULSE_GRADIENT
  )
}

// Adaptive-icon background layer: colour only, no artwork.
export function adaptiveBackground() {
  return svg(`<rect width="${VIEW}" height="${VIEW}" fill="url(#bg)"/>`, BG_GRADIENT)
}

// Adaptive-icon foreground layer: artwork only, on transparency.
//
// Android composites this on a 108dp canvas of which only the central 72dp is
// guaranteed visible. 0.75 puts the pulse inside ~66dp — comfortably within
// that, with a little room so round masks don't clip the line ends.
export function adaptiveForeground(scale = 0.75) {
  return svg(pulse(scale), PULSE_GRADIENT)
}

// Themed-icon layer (Android 13+). The launcher tints this, so it has to be a
// flat silhouette — a gradient here would be flattened to mud.
export function monochromeForeground(scale = 0.75) {
  return svg(pulse(scale, "#ffffff"), "")
}

// Notification small icon. Android keeps only this image's alpha channel and
// paints the result white, so anything with colour in it arrives as a solid
// blob — and given no usable icon at all the system substitutes its own
// generic "!" glyph, which is what the app's notifications were showing.
//
// The launcher mark can't be reused as-is. It is a wide, thin line, and the
// notification slot is a small square: dropped into it whole, the pulse
// occupies about a third of the height and reads as a smudge at 24dp. So this
// keeps the part that carries the identity — the spike cluster — trims the
// long flat leads to stubs, and frames it tightly.
//
// The stroke stays at the mark's own weight. Against this closer frame that
// already lands near 3px at 24dp; heavier weights were tried and the spikes
// merge into a blob at the size this is actually seen.
const NOTIFICATION_POINTS = "120,256 148,256 178,160 208,352 238,210 262,302 286,256 314,256"
const NOTIFICATION_STROKE = STROKE

// Framed on the trimmed mark (x 120→314, y 160→352) plus half the stroke,
// with ~8% padding — the margin Android's own notification icons keep.
const NOTIFICATION_VIEW = "72 111 290 290"

export function notificationIcon() {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${NOTIFICATION_VIEW}" ` +
    `width="${VIEW}" height="${VIEW}">` +
    `<polyline points="${NOTIFICATION_POINTS}" fill="none" stroke="#ffffff" ` +
    `stroke-width="${NOTIFICATION_STROKE}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  )
}
