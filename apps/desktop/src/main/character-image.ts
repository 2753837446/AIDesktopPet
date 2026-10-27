import type { CharacterImageMimeType } from "../core/domain";

export interface DetectedImage {
  mimeType: CharacterImageMimeType;
  extension: "png" | "gif" | "webp" | "jpg";
  width: number;
  height: number;
}

export function detectImage(bytes: Uint8Array): DetectedImage {
  if (matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return {
      mimeType: "image/png",
      extension: "png",
      width: readUInt32BE(bytes, 16),
      height: readUInt32BE(bytes, 20),
    };
  }
  if (matchesAscii(bytes, 0, "GIF87a") || matchesAscii(bytes, 0, "GIF89a")) {
    return {
      mimeType: "image/gif",
      extension: "gif",
      width: readUInt16LE(bytes, 6),
      height: readUInt16LE(bytes, 8),
    };
  }
  if (
    matchesAscii(bytes, 0, "RIFF") &&
    matchesAscii(bytes, 8, "WEBP")
  ) {
    return {
      mimeType: "image/webp",
      extension: "webp",
      ...webpDimensions(bytes),
    };
  }
  if (matches(bytes, 0, [0xff, 0xd8, 0xff])) {
    return {
      mimeType: "image/jpeg",
      extension: "jpg",
      ...jpegDimensions(bytes),
    };
  }
  throw new Error("UNSUPPORTED_CHARACTER_IMAGE");
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } {
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + readUInt24LE(bytes, 24),
      height: 1 + readUInt24LE(bytes, 27),
    };
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    return {
      width: readUInt16LE(bytes, 26) & 0x3fff,
      height: readUInt16LE(bytes, 28) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25) {
    const b1 = bytes[21] ?? 0;
    const b2 = bytes[22] ?? 0;
    const b3 = bytes[23] ?? 0;
    const b4 = bytes[24] ?? 0;
    return {
      width: 1 + b1 + ((b2 & 0x3f) << 8),
      height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
    };
  }
  throw new Error("UNSUPPORTED_WEBP_LAYOUT");
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    let markerOffset = offset + 1;
    while (bytes[markerOffset] === 0xff) {
      markerOffset += 1;
    }
    const marker = bytes[markerOffset];
    if (marker === undefined) {
      break;
    }
    offset = markerOffset + 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
      continue;
    }
    if (marker === 0xda) {
      break;
    }
    if (offset + 1 >= bytes.length) {
      break;
    }

    const segmentLength = readUInt16BE(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      break;
    }
    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf
    ) {
      if (segmentLength < 7) {
        break;
      }
      return {
        height: readUInt16BE(bytes, offset + 3),
        width: readUInt16BE(bytes, offset + 5),
      };
    }
    offset += segmentLength;
  }
  throw new Error("UNSUPPORTED_JPEG_LAYOUT");
}

function matches(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function matchesAscii(bytes: Uint8Array, offset: number, value: string): boolean {
  return [...value].every(
    (char, index) => bytes[offset + index] === char.charCodeAt(0),
  );
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUInt24LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16)
  );
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) >>> 0) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  );
}

function readUInt16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}
