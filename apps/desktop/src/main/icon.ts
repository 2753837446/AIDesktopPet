import { nativeImage, type NativeImage } from "electron";

export function createTrayIcon(): NativeImage {
  const size = 32;
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const dx = x - size / 2 + 0.5;
      const dy = y - size / 2 + 0.5;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > 14.5) {
        continue;
      }

      const highlight = distance < 5;
      pixels[offset] = highlight ? 245 : 210;
      pixels[offset + 1] = highlight ? 196 : 130;
      pixels[offset + 2] = highlight ? 92 : 36;
      pixels[offset + 3] = 255;
    }
  }

  const image = nativeImage.createFromBitmap(pixels, {
    width: size,
    height: size,
    scaleFactor: 1,
  });
  return image.resize({ width: 20, height: 20, quality: "best" });
}
