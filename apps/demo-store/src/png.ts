import { deflateSync } from 'node:zlib';

/** Tiny RGBA rasteriser + PNG encoder, so product images need no binary assets or image libraries. */
export type Rgb = [number, number, number];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export class Canvas {
  readonly px: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
    bg: Rgb,
  ) {
    this.px = new Uint8Array(w * h * 4);
    this.rect(0, 0, w, h, bg);
  }

  set(x: number, y: number, [r, g, b]: Rgb): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (Math.floor(y) * this.w + Math.floor(x)) * 4;
    this.px[i] = r;
    this.px[i + 1] = g;
    this.px[i + 2] = b;
    this.px[i + 3] = 255;
  }

  rect(x: number, y: number, w: number, h: number, c: Rgb): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: Rgb): void {
    for (let j = -ry; j <= ry; j++) {
      for (let i = -rx; i <= rx; i++)
        if ((i * i) / (rx * rx) + (j * j) / (ry * ry) <= 1) this.set(cx + i, cy + j, c);
    }
  }

  png(): Buffer {
    const raw = Buffer.alloc((this.w * 4 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 4 + 1)] = 0;
      Buffer.from(this.px.buffer, y * this.w * 4, this.w * 4).copy(raw, y * (this.w * 4 + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

export const COLORS: Record<string, Rgb> = {
  black: [28, 28, 32],
  blue: [37, 99, 235],
  brown: [120, 72, 40],
  white: [235, 235, 235],
  grey: [120, 125, 135],
};

/**
 * A stylised shoe. `photo` renders the "what arrived" picture a buyer would take: different
 * background and framing, so its bytes (and hash) differ from the listing image.
 */
export function shoeImage(
  color: string,
  opts: { style?: string; photo?: boolean; kind?: string } = {},
): Buffer {
  const c = COLORS[color] ?? COLORS.grey!;
  const cv = new Canvas(320, 200, opts.photo ? [214, 200, 178] : [244, 246, 250]);
  if (opts.photo) cv.rect(0, 150, 320, 50, [170, 150, 120]); // a table top
  if (opts.kind === 'socks') {
    cv.rect(110, 40, 40, 110, c);
    cv.rect(110, 130, 80, 30, c);
    cv.rect(170, 40, 40, 110, c);
    cv.rect(170, 130, 80, 30, c);
    return cv.png();
  }
  const boot = opts.kind === 'boot';
  cv.rect(50, 140, 220, 16, [60, 60, 60]); // sole
  if (opts.style === 'trail' || opts.style === 'hybrid')
    for (let x = 56; x < 266; x += 18) cv.rect(x, 154, 8, 6, [40, 40, 40]); // lugs
  cv.ellipse(150, 118, 100, boot ? 50 : 34, c); // upper
  cv.rect(80, boot ? 50 : 84, 70, boot ? 70 : 36, c); // heel/ankle
  cv.ellipse(232, 128, 36, 18, c); // toe box
  for (let i = 0; i < 4; i++) cv.rect(150 + i * 14, boot ? 80 : 96, 8, 3, [245, 245, 245]); // laces
  if (opts.style === 'hybrid') cv.rect(60, 132, 200, 4, [234, 88, 12]); // hybrid stripe
  return cv.png();
}
