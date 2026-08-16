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

// ── Emergy ────────────────────────────────────────────────────────────────
//
// The mascot is a WebGL model built at runtime, so there is no bitmap of him
// to ship. This is a deliberately flat 2D reading of that model — pot, rim,
// body, sprout, eyes — kept here beside the pulse so both marks stay in one
// place. Coordinates are on the same 512 canvas.

const EMERGY = {
  body:   "#fde68a",
  band:   "#f59e0b",
  gleam:  "#fef3c7",
  leaf:   "#2fb45c",
  stem:   "#1d8a45",
  clay:   "#be6d3d",
  clayDark: "#a25a30",
  soil:   "#9c6836",
  white:  "#fffdf6",
  dark:   "#1e2530",
  rose:   "#fb7185",
}

// One sprout, one body, one pot — written once so the silhouette and the
// colour icon can never drift apart.
//
// Emergy is drawn stockier here than he is on screen: a short stem, leaves
// tucked close, a shallow pot. At full size the tall version is charming, but
// a notification icon is a 24dp square, and a tall figure in a square frame
// has to shrink until nothing is legible. This one is near enough to square
// to fill it.
//
// Extents, which the viewBox below depends on: x 104→408, y 78→450.
const EMERGY_PARTS = {
  stem:   `<path d="M256 160 L256 112" stroke-width="16" stroke-linecap="round" fill="none"/>`,
  leafL:  `<ellipse cx="202" cy="112" rx="42" ry="23" transform="rotate(-26 202 112)"/>`,
  leafR:  `<ellipse cx="312" cy="100" rx="40" ry="22" transform="rotate(22 312 100)"/>`,
  body:   `<rect x="140" y="150" width="232" height="200" rx="90"/>`,
  potRim: `<rect x="104" y="344" width="304" height="48" rx="24"/>`,
  pot:    `<path d="M124 392 L388 392 L350 442 Q346 450 336 450 L176 450 Q166 450 162 442 Z"/>`,
  eyeL:   `<circle cx="214" cy="238" r="29"/>`,
  eyeR:   `<circle cx="298" cy="238" r="29"/>`,
}

// Square, centred on those extents, with a little air: the mark measures
// 304 x 372, so 390 leaves ~8% top and bottom — the margin Android keeps
// around its own notification icons — and pillarboxes the rest.
const EMERGY_VIEW = "61 69 390 390"

// Notification small icon. Only the alpha survives, so this is built as a
// mask: white is kept, black is punched out. The eyes have to be holes rather
// than dark shapes — painted white like everything else they would vanish and
// leave a blank blob, which is the usual reason a mascot makes an
// unrecognisable notification icon.
export function emergySilhouette() {
  const P = EMERGY_PARTS
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${EMERGY_VIEW}" ` +
    `width="${VIEW}" height="${VIEW}">` +
    `<mask id="emergy" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">` +
    `<rect width="512" height="512" fill="black"/>` +
    `<g fill="white" stroke="white">${P.stem}${P.leafL}${P.leafR}${P.body}${P.potRim}${P.pot}</g>` +
    `<rect x="104" y="336" width="304" height="10" fill="black"/>` +
    `<g fill="black" stroke="none">${P.eyeL}${P.eyeR}</g>` +
    `</mask>` +
    `<rect width="512" height="512" fill="white" mask="url(#emergy)"/>` +
    `</svg>`
  )
}

// Notification large icon — the picture Android shows at full colour in the
// shade, where a silhouette would waste a 64dp slot.
export function emergyColorIcon() {
  const P = EMERGY_PARTS
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${EMERGY_VIEW}" ` +
    `width="${VIEW}" height="${VIEW}">` +
    `<g stroke="${EMERGY.stem}">${P.stem}</g>` +
    `<g fill="${EMERGY.leaf}">${P.leafL}</g>` +
    `<g fill="${EMERGY.stem}">${P.leafR}</g>` +
    `<g fill="${EMERGY.body}">${P.body}</g>` +
    `<rect x="140" y="150" width="232" height="44" rx="22" fill="${EMERGY.band}"/>` +
    `<rect x="166" y="166" width="58" height="18" rx="9" fill="${EMERGY.gleam}" opacity="0.75"/>` +
    `<g fill="${EMERGY.rose}" opacity="0.5">` +
    `<ellipse cx="172" cy="280" rx="25" ry="15"/><ellipse cx="340" cy="280" rx="25" ry="15"/></g>` +
    `<g fill="${EMERGY.white}">${P.eyeL}${P.eyeR}</g>` +
    `<g fill="${EMERGY.dark}"><circle cx="217" cy="242" r="17"/><circle cx="301" cy="242" r="17"/></g>` +
    `<g fill="${EMERGY.white}"><circle cx="224" cy="234" r="6"/><circle cx="308" cy="234" r="6"/></g>` +
    `<path d="M230 292 Q256 314 282 292" stroke="${EMERGY.dark}" stroke-width="12" ` +
    `fill="none" stroke-linecap="round"/>` +
    `<g fill="${EMERGY.soil}"><rect x="126" y="344" width="260" height="22" rx="11"/></g>` +
    `<g fill="${EMERGY.clay}">${P.potRim}</g>` +
    `<g fill="${EMERGY.clayDark}">${P.pot}</g>` +
    `</svg>`
  )
}
