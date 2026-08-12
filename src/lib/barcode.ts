// Barcode reading via the browser's built-in BarcodeDetector — supported in
// Chrome/Android WebView (which is what the Capacitor app runs in). No native
// plugin, no external library: snap a photo of the barcode, detect on the
// still image. Callers fall back to manual code entry when unsupported.

interface DetectedBarcode {
  rawValue: string
  format: string
}

interface BarcodeDetectorLike {
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>
}

declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike
  }
}

export function barcodeSupported(): boolean {
  return typeof window !== "undefined" && typeof window.BarcodeDetector === "function"
}

/**
 * Find a product barcode (EAN/UPC) in a captured photo. Returns the digits,
 * or null when nothing readable is in frame / the API is unavailable.
 */
export async function detectBarcode(dataUrl: string): Promise<string | null> {
  if (!barcodeSupported()) return null
  try {
    const detector = new window.BarcodeDetector!({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e"],
    })
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const bitmap = await createImageBitmap(img)
    const found = await detector.detect(bitmap)
    bitmap.close()
    const code = found.find(b => /^\d{6,14}$/.test(b.rawValue))?.rawValue
    return code ?? null
  } catch {
    return null
  }
}
