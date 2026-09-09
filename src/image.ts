/** Compress / resize image file to a JPEG data URL suitable for localStorage. */
export function fileToDataUrl(file: File, maxSide = 1280, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Branje datoteke ni uspelo'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Slika ni veljavna'))
      img.onload = () => {
        let { width, height } = img
        const scale = Math.min(1, maxSide / Math.max(width, height))
        width = Math.round(width * scale)
        height = Math.round(height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas ni na voljo'))
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        try {
          resolve(canvas.toDataURL('image/jpeg', quality))
        } catch (e) {
          reject(e)
        }
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
