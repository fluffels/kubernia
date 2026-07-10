/**
 * Sprite-Sheet-Packer fuer Kubernia (#339).
 *
 * Kombiniert gleich grosse PNG-Quell-Sprites horizontal zu einem Sheet,
 * das Phaser als "sheet"-Eintrag im ASSET_MANIFEST laedt.
 * Voraussetzung: Node >= 22 (WebAssembly ueber den eingebauten
 * WebAssembly-Support – kein extra package noetig).
 *
 * Nutzung: npm run pack:sprites
 *
 * Technisch: liest rohe PNG-Pixel per zlib-Decompression aus dem IDAT-Chunk,
 * kombiniert die Zeilen horizontal und schreibt ein neues PNG.
 *
 * ACHTUNG – Einschraenkung: funktioniert nur mit RGBA-PNGs (Farbtyp 6)
 * ohne Interlacing. Alle PixelLab-Outputs erfullen diese Bedingung.
 */

import { createInflate, deflateSync } from "zlib";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = resolve(ROOT, "assets/pixellab");

// -----------------------------------------------------------------------
// Gruppen-Konfiguration: welche Quell-Sprites → welches Sheet
// -----------------------------------------------------------------------
const GROUPS = [
  {
    out: "grasstufts.png",
    sources: ["grasstuft0.png", "grasstuft1.png", "grasstuft2.png"],
    layout: "horizontal",   // Frames nebeneinander (links→rechts)
  },
];

// -----------------------------------------------------------------------
// Minimalistische PNG-Bibliothek (nur RGBA, kein Interlace, ein IDAT)
// -----------------------------------------------------------------------

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buf, start = 0, end = buf.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function writeChunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

async function parsePNG(filePath) {
  const buf = readFileSync(filePath);
  if (!buf.slice(0, 8).equals(PNG_SIG)) throw new Error(`${filePath}: kein PNG`);

  let offset = 8;
  let width, height, bitDepth, colorType;
  const idatChunks = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.slice(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      const interlace = data[12];
      if (colorType !== 6) throw new Error(`${filePath}: Farbtyp ${colorType}, erwartet 6 (RGBA)`);
      if (bitDepth !== 8) throw new Error(`${filePath}: Bittiefe ${bitDepth}, erwartet 8`);
      if (interlace !== 0) throw new Error(`${filePath}: Interlacing nicht unterstuetzt`);
    } else if (type === "IDAT") {
      idatChunks.push(data);
    }
  }

  // IDAT-Chunks zusammenfuehren und dekomprimieren
  const compressed = Buffer.concat(idatChunks);
  const raw = await inflate(compressed);

  // Filter-Bytes entfernen: jede Zeile hat 1 Filter-Byte + width*4 Pixel-Bytes
  const stride = width * 4;
  const pixels = Buffer.alloc(height * stride);

  let rawOff = 0;
  let prevRow = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[rawOff++];
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) row[x] = raw[rawOff++];

    // Filter rekonstruieren
    if (filter === 0) {
      row.copy(pixels, y * stride);
    } else if (filter === 1) {
      for (let x = 0; x < stride; x++)
        pixels[y * stride + x] = (row[x] + (x < 4 ? 0 : pixels[y * stride + x - 4])) & 0xff;
    } else if (filter === 2) {
      for (let x = 0; x < stride; x++)
        pixels[y * stride + x] = (row[x] + prevRow[x]) & 0xff;
    } else if (filter === 3) {
      for (let x = 0; x < stride; x++) {
        const a = x < 4 ? 0 : pixels[y * stride + x - 4];
        pixels[y * stride + x] = (row[x] + Math.floor((a + prevRow[x]) / 2)) & 0xff;
      }
    } else if (filter === 4) {
      for (let x = 0; x < stride; x++) {
        const a = x < 4 ? 0 : pixels[y * stride + x - 4];
        const b = prevRow[x];
        const c = x < 4 ? 0 : prevRow[x - 4];
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
        pixels[y * stride + x] = (row[x] + pr) & 0xff;
      }
    } else {
      throw new Error(`Unbekannter Filter-Typ ${filter}`);
    }
    pixels.slice(y * stride, (y + 1) * stride).copy(prevRow);
  }

  return { width, height, pixels };
}

function inflate(buf) {
  return new Promise((resolve, reject) => {
    const inflate = createInflate();
    const chunks = [];
    inflate.on("data", (c) => chunks.push(c));
    inflate.on("end", () => resolve(Buffer.concat(chunks)));
    inflate.on("error", reject);
    inflate.end(buf);
  });
}

function buildPNG(width, height, pixels) {
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // Rohe Zeilendaten mit Filter-Byte 0 (None)
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0; // filter: None
    pixels.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
  }

  const compressed = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    PNG_SIG,
    writeChunk("IHDR", ihdr),
    writeChunk("IDAT", compressed),
    writeChunk("IEND", Buffer.alloc(0)),
  ]);
}

// -----------------------------------------------------------------------
// Haupt-Logik
// -----------------------------------------------------------------------

async function packGroup({ out, sources, layout }) {
  const images = await Promise.all(sources.map((s) => parsePNG(resolve(ASSETS, s))));

  // Alle muessen gleich hoch sein (horizontal) / gleich breit (vertical)
  const first = images[0];
  for (const img of images) {
    if (layout === "horizontal" && img.height !== first.height)
      throw new Error(`Hoehe muss gleich sein fuer horizontal layout`);
    if (layout === "vertical" && img.width !== first.width)
      throw new Error(`Breite muss gleich sein fuer vertical layout`);
  }

  let outW, outH, outPixels;

  if (layout === "horizontal") {
    outW = images.reduce((s, i) => s + i.width, 0);
    outH = first.height;
    outPixels = Buffer.alloc(outH * outW * 4);
    let xOff = 0;
    for (const img of images) {
      const srcStride = img.width * 4;
      const dstStride = outW * 4;
      for (let y = 0; y < outH; y++) {
        img.pixels.copy(outPixels, y * dstStride + xOff * 4, y * srcStride, (y + 1) * srcStride);
      }
      xOff += img.width;
    }
  } else {
    outW = first.width;
    outH = images.reduce((s, i) => s + i.height, 0);
    outPixels = Buffer.alloc(outH * outW * 4);
    let yOff = 0;
    for (const img of images) {
      img.pixels.copy(outPixels, yOff * outW * 4);
      yOff += img.height;
    }
  }

  const pngBuf = buildPNG(outW, outH, outPixels);
  const outPath = resolve(ASSETS, out);
  writeFileSync(outPath, pngBuf);
  console.log(`${out}: ${outW}x${outH} (${sources.length} Frames) → ${outPath}`);
}

for (const group of GROUPS) {
  await packGroup(group);
}
console.log("Fertig. Geaenderte PNGs muessen committet werden.");
