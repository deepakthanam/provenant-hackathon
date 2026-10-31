import sharp from 'sharp';

/**
 * Product illustrations for the demo store, drawn as SVG and rendered to PNG with sharp. They are
 * synthetic (no photographs), deterministic (same bytes for the same product), and draw the
 * listed colour on the upper so a vision model can compare it with what a buyer says arrived.
 */

export type ArtKind = 'shoe' | 'boot' | 'socks';
export interface ArtSpec {
  color: string;
  kind: ArtKind;
  /** road · trail · hybrid · racer (shoes); ignored for boots and socks. */
  style?: string;
}

type Rgb = [number, number, number];

const UPPERS: Record<string, Rgb> = {
  black: [36, 37, 42],
  blue: [33, 84, 214],
  brown: [118, 72, 42],
  white: [232, 232, 228],
  grey: [118, 122, 130],
};

const hex = ([r, g, b]: Rgb) =>
  `#${[r, g, b]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const lighten = (c: Rgb, t: number) => hex(mix(c, WHITE, t));
const darken = (c: Rgb, t: number) => hex(mix(c, BLACK, t));

/** Brand orange: the Ovalwork box colour, used on the hybrid's midsole stripe and the sock band. */
const BRAND = '#e5461b';

function defs(upper: Rgb, mid: Rgb): string {
  return `<defs>
  <linearGradient id="up" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${lighten(upper, 0.16)}"/>
    <stop offset="0.55" stop-color="${hex(upper)}"/>
    <stop offset="1" stop-color="${darken(upper, 0.28)}"/>
  </linearGradient>
  <linearGradient id="mid" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${lighten(mid, 0.5)}"/>
    <stop offset="1" stop-color="${darken(mid, 0.12)}"/>
  </linearGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/>
    <stop offset="0.5" stop-color="#fff" stop-opacity="0.18"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <pattern id="knit" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)">
    <path d="M0 3.5 H7" stroke="#fff" stroke-opacity="0.13" stroke-width="1.6"/>
  </pattern>
  <pattern id="mesh" width="8" height="8" patternUnits="userSpaceOnUse">
    <circle cx="4" cy="4" r="1.5" fill="#000" fill-opacity="0.22"/>
  </pattern>
  <filter id="soft" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="7"/></filter>
</defs>`;
}

const SHOE_UPPER =
  'M122 254 C114 214 118 176 140 156 C152 146 170 142 186 146 C198 150 204 160 214 166 C230 176 252 176 268 168 L332 132 C342 126 356 126 364 134 C392 162 430 190 478 206 C522 220 556 230 570 244 C578 252 576 260 566 262 C520 264 300 262 122 254 Z';
const SHOE_MIDSOLE =
  'M112 248 C106 270 108 292 124 298 C140 302 300 300 500 298 C540 296 566 284 576 264 C580 254 576 246 566 246 C420 256 250 256 112 248 Z';

function lugs(y: number, from: number, to: number, w: number, h: number, gap: number, fill: string): string {
  let out = '';
  for (let x = from; x < to; x += w + gap)
    out += `<path d="M${x} ${y} h${w} l-2 ${h} h${-(w - 4)} Z" fill="${fill}"/>`;
  return out;
}

function laces(upper: Rgb): string {
  const lace = upper[0] + upper[1] + upper[2] < 200 ? '#e9e9e4' : lighten(upper, 0.75);
  let out = '';
  for (let i = 0; i < 5; i++) {
    const x = 300 + i * 30;
    const y = 160 + i * 9.5;
    out += `<circle cx="${x - 8}" cy="${y + 10}" r="3.2" fill="${darken(upper, 0.5)}"/>`;
    out += `<rect x="${x - 16}" y="${y - 3}" width="34" height="7" rx="3.5" fill="${lace}" transform="rotate(-24 ${x} ${y})"/>`;
  }
  return out;
}

function shoe(upper: Rgb, style: string): string {
  const trail = style === 'trail';
  const hybrid = style === 'hybrid';
  const racer = style === 'racer';
  const mid: Rgb = trail ? [205, 205, 198] : [246, 246, 242];
  const lift = racer ? -16 : 0;
  const midsole = racer
    ? 'M112 232 C104 262 106 292 124 298 C140 302 300 300 520 300 C552 299 574 288 578 266 C580 250 574 238 560 234 C420 242 250 242 112 232 Z'
    : SHOE_MIDSOLE;
  const outsoleFill = trail ? '#24252a' : '#3a3b40';
  return `${defs(upper, mid)}
<ellipse cx="338" cy="318" rx="236" ry="13" fill="#000" opacity="0.26" filter="url(#soft)"/>
<path d="M118 294 C116 306 122 313 136 314 L500 311 C536 309 562 296 572 278 L566 276 L120 286 Z" fill="${outsoleFill}"/>
${trail ? lugs(313, 132, 500, 14, 9, 7, '#1b1c20') : ''}${hybrid ? lugs(313, 138, 496, 10, 5, 10, '#2a2b30') : ''}
<g transform="translate(0 ${lift})">
  <path d="${SHOE_UPPER}" fill="url(#up)"/>
  <path d="${SHOE_UPPER}" fill="url(#${trail || hybrid ? 'mesh' : 'knit'})"/>
  <path d="M122 252 C116 214 122 182 142 162 C152 174 160 204 164 254 Z" fill="${darken(upper, 0.22)}"/>
  <path d="M470 205 C518 219 554 229 570 244 C578 252 576 260 566 262 C530 263 498 262 468 258 C476 240 476 222 470 205 Z" fill="${trail ? '#2b2c31' : darken(upper, 0.14)}"/>
  <path d="M300 152 L334 130 C344 124 356 125 361 133 L374 150 C352 154 328 160 312 170 Z" fill="${lighten(upper, 0.12)}"/>
  <path d="M140 157 C152 147 170 143 186 147 C198 151 204 161 214 167 C230 177 252 177 268 169" fill="none" stroke="${lighten(upper, 0.22)}" stroke-width="7" stroke-linecap="round"/>
  <rect x="128" y="144" width="16" height="26" rx="4" fill="${darken(upper, 0.35)}" transform="rotate(-12 136 157)"/>
  <ellipse cx="318" cy="222" rx="40" ry="13" fill="none" stroke="${lighten(upper, 0.62)}" stroke-width="5" opacity="0.9"/>
  ${trail ? '<path d="M520 224 C548 232 568 240 574 250 C578 258 574 262 566 262 L532 262 C540 250 536 236 520 224 Z" fill="#1d1e22"/>' : ''}
  ${laces(upper)}
  <path d="${SHOE_UPPER}" fill="url(#sheen)"/>
</g>
<path d="${midsole}" fill="url(#mid)"/>
<path d="M124 ${racer ? 262 : 274} C250 ${racer ? 270 : 282} 420 ${racer ? 270 : 282} 566 ${racer ? 260 : 270}" fill="none" stroke="#000" stroke-opacity="0.08" stroke-width="2"/>
${racer ? '<path d="M150 276 C260 284 420 282 548 270" fill="none" stroke="#17181c" stroke-width="5" stroke-linecap="round"/><path d="M150 276 C260 284 420 282 548 270" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="1.2"/>' : ''}
${hybrid ? `<path d="M128 280 C260 288 420 288 562 276" fill="none" stroke="${BRAND}" stroke-width="6" stroke-linecap="round"/>` : ''}
`;
}

function boot(upper: Rgb): string {
  const shaft =
    'M120 256 C112 200 116 126 138 96 C152 84 182 80 214 86 C230 90 234 102 238 122 C252 152 282 172 322 184 C392 202 462 214 512 226 C550 236 568 248 574 264 C520 266 300 266 120 256 Z';
  return `${defs(upper, [70, 60, 52])}
<ellipse cx="338" cy="322" rx="234" ry="13" fill="#000" opacity="0.28" filter="url(#soft)"/>
<path d="${shaft}" fill="url(#up)"/>
<path d="M120 256 C116 232 118 214 124 204 C220 214 420 232 566 250 C570 254 573 259 574 264 C520 266 300 266 120 256 Z" fill="${darken(upper, 0.3)}"/>
<path d="M140 98 C156 86 184 84 212 90" fill="none" stroke="${lighten(upper, 0.25)}" stroke-width="9" stroke-linecap="round"/>
<path d="M214 90 C226 96 232 108 236 124 C252 152 280 170 318 182 L310 196 C270 184 240 164 222 134 C214 116 208 100 214 90 Z" fill="${darken(upper, 0.12)}"/>
${[0, 1, 2, 3, 4]
  .map((i) => {
    const x = 224 + i * 20;
    const y = 112 + i * 15;
    return `<rect x="${x - 4}" y="${y - 3}" width="30" height="6" rx="3" fill="#d8c8a0" transform="rotate(38 ${x} ${y})"/><circle cx="${x}" cy="${y}" r="4.5" fill="#c9b27a" stroke="#6b5520" stroke-width="1.5"/>`;
  })
  .join('')}
<path d="${shaft}" fill="url(#sheen)"/>
<path d="M112 252 C108 272 110 292 124 300 L524 300 C556 298 574 286 578 268 L570 260 C420 268 250 266 112 252 Z" fill="#3a2f28"/>
<path d="M118 296 C116 308 122 316 136 318 L524 317 C552 316 570 306 576 292 L572 286 L120 290 Z" fill="#1d1a18"/>
${lugs(316, 130, 552, 16, 10, 8, '#141210')}`;
}

function socks(upper: Rgb): string {
  const sock =
    'M0 0 H62 V140 C62 166 80 180 108 180 H146 C168 180 178 196 176 212 C174 230 160 238 140 238 H62 C26 238 0 214 0 178 Z';
  const heel = lighten(upper, 0.32);
  const one = (x: number, y: number, r: number) =>
    `<g transform="translate(${x} ${y}) rotate(${r})">
      <path d="${sock}" fill="url(#up)"/>
      <path d="${sock}" fill="url(#knit)"/>
      <rect x="0" y="0" width="62" height="16" fill="${darken(upper, 0.25)}"/>
      <path d="M0 0 H62 V6 H0 Z" fill="${lighten(upper, 0.2)}"/>
      <path d="M62 150 C62 170 78 180 100 180 L98 238 H62 C40 238 26 228 18 214 Z" fill="${heel}" opacity="0.55"/>
      <path d="M140 180 C164 180 178 196 176 212 C174 230 160 238 140 238 Z" fill="${heel}" opacity="0.55"/>
    </g>`;
  return `${defs(upper, [200, 200, 200])}
<ellipse cx="320" cy="330" rx="200" ry="12" fill="#000" opacity="0.22" filter="url(#soft)"/>
${one(168, 70, -6)}${one(262, 64, 0)}${one(356, 70, 6)}
<rect x="150" y="118" width="340" height="44" fill="${BRAND}"/>
<rect x="150" y="118" width="340" height="44" fill="url(#sheen)"/>
<text x="320" y="149" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="22" letter-spacing="4" fill="#fff">3 PAIRS</text>`;
}

function body(spec: ArtSpec): string {
  const upper = UPPERS[spec.color] ?? UPPERS.grey!;
  if (spec.kind === 'socks') return socks(upper);
  if (spec.kind === 'boot') return boot(upper);
  return shoe(upper, spec.style ?? 'road');
}

/** The listing image: the product alone on a pale tissue ground. */
export function listingSvg(spec: ArtSpec): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
<rect width="640" height="400" fill="#f1f2ef"/>
${body(spec)}
</svg>`;
}

/**
 * The buyer's photo of what arrived: a different scene (a table, warm light, a slight angle) so
 * the bytes and hash differ from the listing, while the product's colour stays readable.
 */
export function photoSvg(spec: ArtSpec): string {
  let grain = '';
  for (let i = 0; i < 14; i++) {
    const y = 262 + i * 10 + ((i * 7) % 5);
    grain += `<path d="M0 ${y} C160 ${y - 4} 420 ${y + 5} 640 ${y - 2}" stroke="#7a5a36" stroke-opacity="0.18" stroke-width="1.4" fill="none"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
<defs>
  <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9e2d6"/><stop offset="1" stop-color="#d9cfbf"/></linearGradient>
  <linearGradient id="table" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c6a678"/><stop offset="1" stop-color="#9f7b4f"/></linearGradient>
  <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.38"/></radialGradient>
</defs>
<rect width="640" height="400" fill="url(#wall)"/>
<rect y="250" width="640" height="150" fill="url(#table)"/>
${grain}
<g transform="translate(40 32) rotate(-5 320 220) scale(0.9)">${body(spec)}</g>
<rect width="640" height="400" fill="#ff9d4d" opacity="0.07"/>
<rect width="640" height="400" fill="url(#vignette)"/>
</svg>`;
}

const cache = new Map<string, Promise<Buffer>>();

/** Renders (and caches) a product image as PNG. */
export function renderPng(spec: ArtSpec, photo = false): Promise<Buffer> {
  const key = `${spec.kind}:${spec.style}:${spec.color}:${photo}`;
  let hit = cache.get(key);
  if (!hit) {
    const svg = photo ? photoSvg(spec) : listingSvg(spec);
    hit = sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
    cache.set(key, hit);
  }
  return hit;
}
