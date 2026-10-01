// Minimal dependency-free PNG encoder (8-bit RGBA, no filtering).
import zlib from "node:zlib";

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {number} width @param {number} height @param {Uint8Array} rgba */
export function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // color type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Parses "#rrggbb" or "rgba(r, g, b, a)" into [r, g, b, a(0..255)]. */
export function parseColor(color) {
  if (color.startsWith("#")) {
    return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)).concat(255);
  }
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`Unsupported color: ${color}`);
  const [r, g, b, a = "1"] = m[1].split(",").map((s) => s.trim());
  return [Number(r), Number(g), Number(b), Math.round(Number(a) * 255)];
}
