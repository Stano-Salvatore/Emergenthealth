/* eslint-disable @typescript-eslint/no-explicit-any */
// Camera helper — captures a photo and returns a compressed JPEG data URL.
// Uses the Capacitor Camera plugin inside the Android app; falls back to a
// hidden <input type="file" capture> on the web so it works in any browser.

const MAX_DIM = 1024     // longest edge, px
const QUALITY = 0.6      // JPEG quality

/** Downscale + re-encode an image data URL to keep payloads small (~50-150KB). */
function compress(dataUrl: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement("canvas")
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext("2d")
      if (!ctx) { resolve(dataUrl); return }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL("image/jpeg", QUALITY))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Web fallback: open the camera/gallery via a file input. */
function capturePhotoWeb(): Promise<string | null> {
  return new Promise(resolve => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "image/*"
    input.setAttribute("capture", "environment")
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) { resolve(null); return }
      try {
        resolve(await compress(await fileToDataUrl(file)))
      } catch {
        resolve(null)
      }
    }
    // If the user cancels, onchange never fires — that's fine, the promise
    // just never resolves and the caller's UI stays put.
    input.click()
  })
}

/**
 * Capture a photo. Returns a compressed JPEG data URL, or null if cancelled.
 */
export async function capturePhoto(): Promise<string | null> {
  if (typeof window === "undefined") return null

  try {
    const core = await import("@capacitor/core")
    if ((core as any).Capacitor?.isNativePlatform?.() === true) {
      const mod = await import("@capacitor/camera")
      const Camera = (mod as any).Camera
      const CameraResultType = (mod as any).CameraResultType
      const CameraSource = (mod as any).CameraSource
      const photo = await Camera.getPhoto({
        quality: 70,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Prompt, // let the user pick camera or gallery
        width: MAX_DIM,
      })
      if (!photo?.dataUrl) return null
      return await compress(photo.dataUrl)
    }
  } catch {
    // fall through to web
  }

  return capturePhotoWeb()
}
