import { CATALOG, type Product } from './catalog';

/** HTML for the Ovalwork Running storefront: the stockroom wall and the opened box. */

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const STORE_NAME = 'Ovalwork Running';

const SWATCH: Record<string, string> = {
  black: '#26272b',
  blue: '#2154d6',
  brown: '#76482a',
  white: '#ececea',
  grey: '#777b83',
};

export const AISLES = [
  { id: 'road', label: 'Road' },
  { id: 'trail', label: 'Trail' },
  { id: 'hybrid', label: 'Hybrid' },
  { id: 'hiking', label: 'Hiking' },
  { id: 'socks', label: 'Socks' },
] as const;
export type AisleId = (typeof AISLES)[number]['id'];

export function aisleOf(p: Product): AisleId {
  if (p.kind === 'socks') return 'socks';
  const style = p.attributes.style ?? '';
  if (style === 'hiking') return 'hiking';
  if (style.includes('hybrid')) return 'hybrid';
  return style === 'trail' ? 'trail' : 'road';
}

export function artStyle(p: Product): string | undefined {
  if (p.kind !== 'shoe') return undefined;
  if (p.sku.startsWith('PRO-')) return 'racer';
  const style = p.attributes.style ?? 'road';
  return style.includes('hybrid') ? 'hybrid' : style;
}

const bay = (p: Product) => `A-${String(CATALOG.indexOf(p) + 1).padStart(2, '0')}`;
const days = (p: Product) => `${p.delivery_promise.min_days}–${p.delivery_promise.max_days} days`;
const price = (p: Product) => `$${p.price.value}`;

/** A box-end barcode: bars derived from the SKU, so every box prints its own. Decorative. */
function barcode(sku: string): string {
  let x = 0;
  let bars = '';
  for (const ch of `*${sku}*`) {
    const code = ch.charCodeAt(0);
    for (let i = 0; i < 4; i++) {
      const w = ((code >> i) & 1) + 1;
      if (i % 2 === 0) bars += `<rect x="${x}" width="${w}" height="30"/>`;
      x += w + 1;
    }
  }
  return `<svg class="barcode" viewBox="0 0 ${x} 30" preserveAspectRatio="none" aria-hidden="true" focusable="false">${bars}</svg>`;
}

const icon = {
  search:
    '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 13l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  truck:
    '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M2 5h10v8H2zM12 8h3.5l2.5 3v2h-6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="5.5" cy="14.5" r="1.6" fill="currentColor"/><circle cx="15" cy="14.5" r="1.6" fill="currentColor"/></svg>',
  arrow:
    '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 10h11M11 6l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const FONTS = `
@font-face{font-family:"Barlow Condensed";src:url(/fonts/barlow-condensed-latin-600-normal.woff2) format("woff2");font-weight:600;font-display:swap}
@font-face{font-family:"Barlow Condensed";src:url(/fonts/barlow-condensed-latin-700-normal.woff2) format("woff2");font-weight:700;font-display:swap}
@font-face{font-family:"Barlow Condensed";src:url(/fonts/barlow-condensed-latin-800-normal.woff2) format("woff2");font-weight:800;font-display:swap}
@font-face{font-family:"Barlow";src:url(/fonts/barlow-latin-400-normal.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"Barlow";src:url(/fonts/barlow-latin-500-normal.woff2) format("woff2");font-weight:500;font-display:swap}
@font-face{font-family:"Barlow";src:url(/fonts/barlow-latin-600-normal.woff2) format("woff2");font-weight:600;font-display:swap}
@font-face{font-family:"JetBrains Mono";src:url(/fonts/jetbrains-mono-latin-400-normal.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"JetBrains Mono";src:url(/fonts/jetbrains-mono-latin-600-normal.woff2) format("woff2");font-weight:600;font-display:swap}`;

export const FONT_FILES = [
  ['barlow-condensed', 'barlow-condensed-latin-600-normal.woff2'],
  ['barlow-condensed', 'barlow-condensed-latin-700-normal.woff2'],
  ['barlow-condensed', 'barlow-condensed-latin-800-normal.woff2'],
  ['barlow', 'barlow-latin-400-normal.woff2'],
  ['barlow', 'barlow-latin-500-normal.woff2'],
  ['barlow', 'barlow-latin-600-normal.woff2'],
  ['jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff2'],
  ['jetbrains-mono', 'jetbrains-mono-latin-600-normal.woff2'],
] as const;

const CSS = `${FONTS}
:root{
  --box:#e5461b;--box-lit:#f0602f;--box-deep:#a92f0e;--box-ink:#3d1205;
  --steel:#1d1f22;--steel-2:#2e3136;--steel-3:#4a4e55;
  --wall:#d6d8d5;--wall-2:#c9ccc8;
  --label:#fbfbf8;--ink:#151515;--ink-2:#45464a;--ink-3:#6a6c70;--rule:rgba(21,21,21,.16);
  --display:"Barlow Condensed","Arial Narrow",sans-serif;--body:"Barlow","Segoe UI",sans-serif;--data:"JetBrains Mono","Cascadia Mono",monospace;
  --ease:cubic-bezier(.16,1,.3,1);
  color-scheme:light;
}
*{box-sizing:border-box}
html{background:var(--wall);-webkit-text-size-adjust:100%}
body{margin:0;font:400 16px/1.5 var(--body);color:var(--ink);font-variant-numeric:tabular-nums}
::selection{background:var(--box);color:#fff}
a{color:inherit}
:focus-visible{outline:3px solid var(--box);outline-offset:3px}
img{display:block;max-width:100%;height:auto}
.wrap{max-width:1360px;margin:0 auto;padding:0 clamp(16px,3vw,40px)}
.data{font-family:var(--data);font-size:.8125em;letter-spacing:0}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* top bar: the stockroom's steel */
.bar{background:var(--steel);color:#f3f3f1;position:sticky;top:0;z-index:20;box-shadow:0 1px 0 #000,0 6px 18px rgba(0,0,0,.18)}
.bar .wrap{display:flex;align-items:center;gap:clamp(12px,3vw,40px);min-height:68px;flex-wrap:wrap;padding-block:10px}
.mark{display:flex;align-items:baseline;gap:.4em;text-decoration:none;font-family:var(--display);text-transform:uppercase;line-height:1}
.mark b{font-weight:800;font-size:30px;letter-spacing:.01em}
.mark span{font-weight:600;font-size:18px;letter-spacing:.14em;color:#c6c7c4}
.mark i{display:inline-block;width:26px;height:16px;border:4px solid var(--box);border-radius:50%;transform:translateY(1px)}
.find{flex:1 1 320px;display:flex;max-width:560px;background:#fff;border-radius:3px;overflow:hidden}
.find input{flex:1;min-width:0;border:0;font:500 16px var(--body);padding:11px 14px;color:var(--ink);background:transparent}
.find input::placeholder{color:#6f7176}
.find input:focus{outline:none}
.find:focus-within{box-shadow:0 0 0 3px var(--box)}
.find button{border:0;background:var(--box);color:#fff;padding:0 16px;display:flex;align-items:center;gap:6px;font:700 15px var(--display);letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
.find button svg{width:18px;height:18px}
.find button:hover{background:var(--box-deep)}
.demo-flag{margin-left:auto;font:600 13px var(--display);letter-spacing:.1em;text-transform:uppercase;color:#c6c7c4;border:1px solid var(--steel-3);padding:5px 9px;border-radius:2px;white-space:nowrap}

/* shelf header */
.head{padding-block:clamp(22px,3.2vw,40px) 4px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px 40px;align-items:end}
.head nav{grid-column:1/-1}
.head h1{font:800 clamp(34px,4.4vw,62px)/.92 var(--display);text-transform:uppercase;letter-spacing:-.005em;margin:0;max-width:20ch;text-wrap:balance}
.head h1 em{font-style:normal;color:var(--box)}
.head p{margin:0;font-size:17px;color:var(--ink-2);max-width:46ch}
.aisles{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;padding:0;list-style:none}
.aisles a{display:inline-flex;align-items:baseline;gap:8px;text-decoration:none;font:700 17px var(--display);letter-spacing:.08em;text-transform:uppercase;padding:8px 14px;border:2px solid var(--ink);border-radius:2px;background:transparent;transition:background .15s,color .15s}
.aisles a span{font:400 12px var(--data);opacity:.7}
.aisles a:hover{background:var(--label)}
.aisles a[aria-current="page"]{background:var(--ink);color:var(--label)}

/* the wall: box ends standing on steel shelves */
.wall{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));column-gap:0;row-gap:0;margin:10px 0 0;padding:0;list-style:none}
.slot{position:relative;padding:22px 14px 26px;display:flex;flex-direction:column}
.slot::after{content:"";position:absolute;left:0;right:0;bottom:0;height:16px;background:linear-gradient(var(--steel-3),var(--steel-2) 35%,var(--steel));box-shadow:0 6px 10px -4px rgba(0,0,0,.35)}
.box{position:relative;display:flex;flex-direction:column;flex:1;text-decoration:none;background:var(--box);border-radius:2px;padding:12px 12px 14px;box-shadow:inset 0 3px 0 var(--box-lit),inset 0 -10px 18px -10px rgba(0,0,0,.35),0 2px 0 rgba(0,0,0,.25);transition:transform .32s var(--ease),box-shadow .32s var(--ease)}
.box::before{content:"";position:absolute;left:0;right:0;top:0;height:20px;background:linear-gradient(rgba(255,255,255,.08),rgba(0,0,0,.14));border-bottom:1px solid rgba(0,0,0,.22);border-radius:2px 2px 0 0}
.box:hover,.box:focus-visible{transform:translateY(-8px);box-shadow:inset 0 3px 0 var(--box-lit),inset 0 -10px 18px -10px rgba(0,0,0,.35),0 18px 26px -10px rgba(0,0,0,.45)}
.window{position:relative;margin-top:14px;border-radius:10px;overflow:hidden;background:#f1f2ef;box-shadow:inset 0 0 0 3px var(--box-deep),inset 0 8px 14px rgba(0,0,0,.25)}
.window img{width:100%;aspect-ratio:16/10;object-fit:cover;mix-blend-mode:multiply}
.bayno{position:absolute;top:10px;right:10px;font:700 13px var(--data);color:var(--box-ink);background:rgba(255,255,255,.55);padding:1px 6px;border-radius:2px}
.label{flex:1;display:flex;flex-direction:column;background:var(--label);margin-top:12px;padding:12px 12px 10px;border-radius:2px;box-shadow:0 1px 0 rgba(0,0,0,.2)}
.label .top{display:flex;justify-content:space-between;gap:8px;align-items:baseline;border-bottom:2px solid var(--ink);padding-bottom:6px}
.label .model{font:800 26px/1 var(--display);text-transform:uppercase;letter-spacing:.01em}
.label .sku{font:600 12px var(--data);color:var(--ink-2);white-space:nowrap}
.label .title{margin:6px 0 8px;font-size:15px;color:var(--ink-2)}
.fields{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--rule)}
.fields div{padding:6px 0 5px;border-bottom:1px solid var(--rule)}
.fields div:nth-child(odd){padding-right:10px;border-right:1px solid var(--rule)}
.fields div:nth-child(even){padding-left:10px}
.k{display:block;font:600 11px var(--display);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.v{display:flex;align-items:center;gap:7px;font:700 18px/1.2 var(--display);text-transform:uppercase;letter-spacing:.02em}
.chip{width:14px;height:14px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.25)}
.v.size{font-size:26px;line-height:1}
.label .foot{margin-top:auto!important;padding-top:10px;display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-top:10px}
.price{font:800 34px/.9 var(--display);letter-spacing:-.01em}
.price small{font:600 13px var(--data);letter-spacing:0;color:var(--ink-3);margin-left:4px}
.barcode{width:96px;height:30px;fill:var(--ink)}
.empty{grid-column:1/-1;background:var(--label);padding:40px;border:2px dashed var(--ink-3);text-align:center;font-size:18px}
.empty b{display:block;font:800 30px var(--display);text-transform:uppercase;margin-bottom:6px}

/* product page: the opened box */
.crumbs{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding-top:22px;font:600 15px var(--display);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-2)}
.crumbs a{text-decoration:none;border-bottom:2px solid transparent}
.crumbs a:hover{border-color:var(--box)}
.pdp{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:clamp(24px,4vw,64px);align-items:start;padding-block:26px 56px}
.crate{position:sticky;top:110px;margin-top:clamp(40px,7vw,90px)}
.lid{position:absolute;left:-2%;right:-2%;top:0;height:15%;background:var(--box);border-radius:3px;box-shadow:inset 0 3px 0 var(--box-lit),inset 0 -6px 0 rgba(0,0,0,.18),0 10px 18px -8px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:3;transform-origin:20% 100%;transform:translate(0,-112%) rotate(-3.5deg);animation:lid 1.1s var(--ease) .15s both}
.lid span{font:800 clamp(18px,2.4vw,30px) var(--display);letter-spacing:.32em;color:var(--box-ink);opacity:.55;text-transform:uppercase}
@keyframes lid{from{transform:translate(0,0) rotate(0)}to{transform:translate(0,-112%) rotate(-3.5deg)}}
.inside{position:relative;background:var(--box-deep);border-radius:3px;padding:3.5% 3.5% 0;box-shadow:inset 0 14px 22px rgba(0,0,0,.4)}
.tissue{position:relative;background:linear-gradient(115deg,#fbfbf9 0 30%,#eceeeb 30.2% 46%,#f8f8f6 46.2% 70%,#e7e9e6 70.2%);border-radius:2px 2px 0 0;padding:2% 2% 0;overflow:hidden}
.tissue img{width:100%;aspect-ratio:16/10;object-fit:cover;mix-blend-mode:multiply;animation:rise 1.1s var(--ease) .25s both}
@keyframes rise{from{transform:translateY(7%)}to{transform:none}}
.front{position:relative;margin-top:-5%;height:clamp(56px,7vw,96px);background:var(--box);border-radius:0 0 3px 3px;box-shadow:inset 0 4px 0 var(--box-lit),0 16px 30px -12px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:space-between;padding:0 4%;z-index:2}
.front b{font:800 clamp(22px,3vw,40px) var(--display);letter-spacing:.24em;color:var(--box-ink);opacity:.6;text-transform:uppercase}
.front .data{color:var(--box-ink);font-weight:600;opacity:.75}
.biglabel{background:var(--label);padding:clamp(18px,2.4vw,30px);border-radius:2px;box-shadow:0 1px 0 rgba(0,0,0,.2),0 14px 30px -18px rgba(0,0,0,.4)}
.biglabel .top{display:flex;justify-content:space-between;gap:12px;border-bottom:3px solid var(--ink);padding-bottom:10px;align-items:baseline}
.biglabel h1{margin:0;font:800 clamp(40px,4.6vw,64px)/.9 var(--display);text-transform:uppercase;letter-spacing:-.005em}
.biglabel .title{font-size:19px;color:var(--ink-2);margin:12px 0 0}
.biglabel .desc{margin:10px 0 18px;max-width:52ch}
.pricebar{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:14px 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.pricebar .price{font-size:56px}
.ship{display:flex;align-items:center;gap:8px;font:700 17px var(--display);letter-spacing:.06em;text-transform:uppercase}
.ship svg{width:22px;height:22px;color:var(--box)}
.facts{width:100%;border-collapse:collapse;margin-top:6px}
.facts th,.facts td{text-align:left;padding:9px 0;border-bottom:1px solid var(--rule);vertical-align:baseline}
.facts th{font:600 12px var(--display);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);width:38%}
.facts td{font:700 20px var(--display);text-transform:uppercase;letter-spacing:.03em}
.facts td.data{font:500 14px var(--data);text-transform:none}
.rail{margin-top:20px}
.rail h2,.colours h2{font:600 12px var(--display);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);margin:0 0 8px}
.rail ol{display:flex;gap:6px;list-style:none;margin:0;padding:0;flex-wrap:wrap}
.rail li>*{display:grid;place-items:center;min-width:48px;height:48px;font:700 21px var(--display);border-radius:2px;text-decoration:none}
.rail .here{background:var(--ink);color:var(--label)}
.rail a{border:2px solid var(--ink)}
.rail a:hover{background:var(--box);border-color:var(--box);color:#fff}
.rail .none{color:#a7a9ad;border:1px dashed #b6b8bb;text-decoration:line-through;text-decoration-thickness:1.5px}
.colours{margin-top:18px}
.colours ul{display:flex;gap:10px;list-style:none;margin:0;padding:0}
.colours a,.colours span{display:inline-flex;align-items:center;gap:8px;padding:7px 12px 7px 8px;border-radius:2px;font:700 16px var(--display);letter-spacing:.06em;text-transform:uppercase;text-decoration:none;border:2px solid var(--ink)}
.colours span{background:var(--ink);color:var(--label)}
.colours a:hover{background:var(--label)}
.colours .chip{width:18px;height:18px}
.agent{margin-top:22px;border:2px solid var(--ink);border-radius:2px;background:var(--label)}
.agent summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;background:var(--ink);color:var(--label);font:700 18px var(--display);letter-spacing:.08em;text-transform:uppercase}
.agent summary::-webkit-details-marker{display:none}
.agent summary svg{width:20px;height:20px;transition:transform .25s var(--ease)}
.agent[open] summary svg{transform:rotate(90deg)}
.agent summary:hover{background:var(--steel-2)}
.agent .inner{padding:14px 16px 16px}
.agent p{margin:0 0 10px;color:var(--ink-2)}
.agent pre{margin:0;max-height:340px;overflow:auto;background:var(--steel);color:#e9e9e6;padding:14px;border-radius:2px;font:400 13px/1.55 var(--data);white-space:pre-wrap;overflow-wrap:anywhere}
.agent pre::selection,.agent pre *::selection{background:var(--box)}
.shelfrow h2{font:800 30px var(--display);text-transform:uppercase;margin:0}
.shelfrow{padding-bottom:40px}
.shelfrow .wall{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}

footer{background:var(--steel);color:#c6c7c4;margin-top:40px}
footer .wrap{display:flex;gap:24px;flex-wrap:wrap;justify-content:space-between;padding-block:26px;font-size:14px}
footer p{margin:0;max-width:70ch}
.desk{font:600 13px var(--display);letter-spacing:.1em;text-transform:uppercase}
.desk.on{color:#fff;background:var(--box);padding:4px 8px;border-radius:2px}

@media (max-width:900px){.head{grid-template-columns:1fr}.crate{position:relative;top:0}.pdp{grid-template-columns:1fr}.demo-flag{margin-left:0}}
@media (max-width:520px){.wall{grid-template-columns:1fr}.slot{padding-inline:2px}.pricebar .price{font-size:46px}.bar .wrap{gap:10px}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
::-webkit-scrollbar{width:12px;height:12px}::-webkit-scrollbar-thumb{background:var(--steel-3);border-radius:6px;border:3px solid var(--wall)}::-webkit-scrollbar-track{background:var(--wall)}
`;

function shell(title: string, body: string, opts: { q?: string; wrongItem: boolean; head?: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="preload" href="/fonts/barlow-condensed-latin-800-normal.woff2" as="font" type="font/woff2" crossorigin>
${opts.head ?? ''}<style>${CSS}</style>
</head><body>
<header class="bar"><div class="wrap">
  <a class="mark" href="/" aria-label="${STORE_NAME} home"><i aria-hidden="true"></i><b>Ovalwork</b><span>Running</span></a>
  <form class="find" action="/" method="get" role="search">
    <label class="sr" for="q">Search the wall</label>
    <input id="q" name="q" type="search" value="${esc(opts.q ?? '')}" placeholder="Search: black trail, size 10, socks…" autocomplete="off">
    <button type="submit">${icon.search}<span>Find</span></button>
  </form>
  <span class="demo-flag" title="A demo merchant for Provenant. Products and images are synthetic.">Demo store</span>
</div></header>
${body}
<footer><div class="wrap">
  <p>${STORE_NAME} is a demo merchant for Provenant. The products and pictures are synthetic and nothing here is for sale; AI shopping agents in the demo buy from these pages.</p>
  <span class="desk${opts.wrongItem ? ' on' : ''}">Shipping desk: ${opts.wrongItem ? 'substituting items' : 'ships what you ordered'}</span>
</div></footer>
</body></html>`;
}

function boxEnd(p: Product, headingTag: 'h2' | 'h3' = 'h2'): string {
  const color = p.attributes.color ?? '';
  const search = [p.model, p.title, p.sku, ...Object.values(p.attributes), ...p.tags].join(' ').toLowerCase();
  return `<li class="slot" data-search="${esc(search)}">
<a class="box" href="/p/${esc(p.sku)}" aria-label="${esc(`${p.model}, ${p.title}, ${price(p)}`)}">
  <div class="window"><img src="/img/${esc(p.sku)}.png" width="640" height="400" alt="${esc(p.title)}" loading="lazy"><span class="bayno">${bay(p)}</span></div>
  <div class="label">
    <div class="top"><${headingTag} class="model" style="margin:0">${esc(p.model)}</${headingTag}><span class="sku">${esc(p.sku)}</span></div>
    <p class="title">${esc(p.title)}</p>
    <div class="fields">
      <div><span class="k">Colour</span><span class="v"><i class="chip" style="background:${SWATCH[color] ?? '#999'}"></i>${esc(color)}</span></div>
      <div><span class="k">Size${p.kind === 'socks' ? '' : ' US'}</span><span class="v size">${esc(p.attributes.size ?? '')}</span></div>
      <div><span class="k">Style</span><span class="v">${esc(p.attributes.style ?? '')}</span></div>
      <div><span class="k">Delivery</span><span class="v">${days(p)}</span></div>
    </div>
    <div class="foot"><span class="price">${price(p)}<small>USD</small></span>${barcode(p.sku)}</div>
  </div>
</a></li>`;
}

export function homePage(opts: {
  products: Product[];
  q: string;
  aisle: AisleId | null;
  wrongItem: boolean;
}): string {
  const counts = new Map<AisleId, number>();
  for (const p of CATALOG) counts.set(aisleOf(p), (counts.get(aisleOf(p)) ?? 0) + 1);
  const qs = (a: AisleId | null) => {
    const sp = new URLSearchParams();
    if (opts.q) sp.set('q', opts.q);
    if (a) sp.set('aisle', a);
    const s = sp.toString();
    return s ? `/?${s}` : '/';
  };
  const tabs = [
    `<li><a href="${qs(null)}"${opts.aisle ? '' : ' aria-current="page"'}>Whole wall <span>${CATALOG.length}</span></a></li>`,
    ...AISLES.map(
      (a) =>
        `<li><a href="${qs(a.id)}"${opts.aisle === a.id ? ' aria-current="page"' : ''}>${a.label} <span>${counts.get(a.id) ?? 0}</span></a></li>`,
    ),
  ].join('');
  const boxes = opts.products.map((p) => boxEnd(p)).join('');
  const empty = `<li class="empty"${opts.products.length ? ' hidden' : ''}><b>Nothing on this shelf</b>No box matches “<span data-q>${esc(opts.q)}</span>”. Try a colour, a size or a style, or <a href="/">see the whole wall</a>.</li>`;
  const body = `<main>
<section class="head wrap" aria-labelledby="wall-title">
  <h1 id="wall-title">Every box says <em>exactly</em> what’s inside.</h1>
  <p>Colour, size, style, price and delivery time are printed on the end of every box, the same facts our product pages publish for shopping agents.</p>
  <nav aria-label="Aisles"><ul class="aisles">${tabs}</ul></nav>
</section>
<section class="wrap" aria-label="Boxes on the wall">
  <ul class="wall" id="wall">${boxes}${empty}</ul>
</section>
</main>
<script>
(() => {
  const input = document.getElementById('q');
  const slots = [...document.querySelectorAll('#wall .slot')];
  const empty = document.querySelector('#wall .empty');
  const stop = new Set(['size','under','for','a','the','and','pair','of','me','buy','some','shoes','shoe','running']);
  input.addEventListener('input', () => {
    const tokens = input.value.toLowerCase().split(/[^a-z0-9/]+/).filter((t) => t && !stop.has(t));
    let shown = 0;
    for (const s of slots) {
      const hay = s.dataset.search;
      const ok = tokens.every((t) => hay.includes(t) || hay.includes(t.replace(/s$/, '')));
      s.hidden = !ok;
      if (ok) shown++;
    }
    empty.hidden = shown > 0;
    empty.querySelector('[data-q]').textContent = input.value;
  });
})();
</script>`;
  return shell(`${STORE_NAME} · the wall`, body, { q: opts.q, wrongItem: opts.wrongItem });
}

export function productPage(opts: { product: Product; jsonLd: unknown; wrongItem: boolean }): string {
  const p = opts.product;
  const color = p.attributes.color ?? '';
  const siblings = CATALOG.filter((x) => x.model === p.model);
  const sameColour = siblings.filter((x) => x.attributes.color === color);
  const sizes = p.kind === 'socks' ? ['S', 'M', 'L', 'XL'] : ['7', '8', '9', '10', '11', '12', '13'];
  const rail = sizes
    .map((s) => {
      if (s === p.attributes.size) return `<li><span class="here" aria-current="true">${s}</span></li>`;
      const other = sameColour.find((x) => x.attributes.size === s);
      return other
        ? `<li><a href="/p/${esc(other.sku)}" aria-label="Size ${s}">${s}</a></li>`
        : `<li><span class="none" aria-label="Size ${s}, not stocked">${s}</span></li>`;
    })
    .join('');
  const colours = [...new Map(siblings.map((x) => [x.attributes.color ?? '', x])).values()]
    .map((x) => {
      const c = x.attributes.color ?? '';
      const chip = `<i class="chip" style="background:${SWATCH[c] ?? '#999'}"></i>${esc(c)}`;
      if (c === color) return `<li><span aria-current="true">${chip}</span></li>`;
      const target =
        siblings.find((y) => y.attributes.color === c && y.attributes.size === p.attributes.size) ?? x;
      return `<li><a href="/p/${esc(target.sku)}">${chip}</a></li>`;
    })
    .join('');
  const attrs = Object.entries(p.attributes)
    .map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td data-attr="${esc(k)}">${esc(v)}</td></tr>`)
    .join('');
  const aisle = AISLES.find((a) => a.id === aisleOf(p))!;
  const related = CATALOG.filter((x) => x.model !== p.model && aisleOf(x) !== 'socks' && x.kind === p.kind)
    .slice(0, 3)
    .map((x) => boxEnd(x, 'h3'))
    .join('');
  const ld = JSON.stringify(opts.jsonLd).replace(/</g, '\\u003c');
  const ldPretty = esc(JSON.stringify(opts.jsonLd, null, 2));
  const body = `<main class="wrap">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">The wall</a><span aria-hidden="true">/</span><a href="/?aisle=${aisle.id}">${aisle.label}</a><span aria-hidden="true">/</span><span class="data">${esc(p.sku)}</span></nav>
<div class="pdp">
  <div class="crate">
    <div class="lid" aria-hidden="true"><span>Ovalwork</span></div>
    <div class="inside"><div class="tissue"><img src="/img/${esc(p.sku)}.png" width="640" height="400" alt="${esc(p.title)}"></div></div>
    <div class="front" aria-hidden="true"><b>Ovalwork</b><span class="data">${bay(p)} · ${esc(p.sku)}</span></div>
  </div>
  <article class="biglabel" aria-labelledby="model">
    <div class="top"><h1 id="model">${esc(p.model)}</h1><span class="sku data">${esc(p.sku)}</span></div>
    <p class="title">${esc(p.title)}</p>
    <p class="desc">${esc(p.description)}</p>
    <div class="pricebar">
      <p class="price" data-price="${esc(p.price.value)}" style="margin:0">$${esc(p.price.value)}<small>${esc(p.price.currency)}</small></p>
      <p class="ship" style="margin:0">${icon.truck}Delivered in ${days(p)}</p>
    </div>
    <table class="facts">
      <caption class="sr">Printed on the box</caption>
      ${attrs}
      <tr><th scope="row">delivery</th><td>${p.delivery_promise.min_days}–${p.delivery_promise.max_days} days</td></tr>
      <tr><th scope="row">sku</th><td class="data">${esc(p.sku)}</td></tr>
    </table>
    <div class="rail"><h2>${p.kind === 'socks' ? 'Size' : 'US size'}</h2><ol>${rail}</ol></div>
    ${siblings.length > 1 || colours ? `<div class="colours"><h2>Colour</h2><ul>${colours}</ul></div>` : ''}
    <details class="agent">
      <summary>What a shopping agent reads here ${icon.arrow}</summary>
      <div class="inner">
        <p>This page publishes its facts as schema.org JSON-LD. An agent buying through Provenant snapshots exactly this, with the picture, before it pays, so a later dispute can be checked against it.</p>
        <pre><code>${ldPretty}</code></pre>
      </div>
    </details>
  </article>
</div>
${related ? `<section class="shelfrow" aria-labelledby="more"><h2 id="more">Also on the wall</h2><ul class="wall">${related}</ul></section>` : ''}
</main>`;
  return shell(`${p.model}: ${p.title} · ${STORE_NAME}`, body, {
    wrongItem: opts.wrongItem,
    head: `<script type="application/ld+json">${ld}</script>\n`,
  });
}

export function notFoundPage(wrongItem: boolean): string {
  return shell(
    `Not on the wall · ${STORE_NAME}`,
    `<main class="wrap head"><h1>That box isn’t on the wall.</h1><p>The link may be old, or the SKU mistyped. <a href="/">Back to the whole wall</a>.</p></main>`,
    { wrongItem },
  );
}
