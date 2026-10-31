---
name: Ovalwork Running (demo store)
description: The stockroom wall. Every product is a box end whose printed label states exactly what is inside.
colors:
  box: "#e5461b"
  box-lit: "#f0602f"
  box-deep: "#a92f0e"
  box-ink: "#3d1205"
  steel: "#1d1f22"
  steel-2: "#2e3136"
  steel-3: "#4a4e55"
  wall: "#d6d8d5"
  label: "#fbfbf8"
  ink: "#151515"
  ink-2: "#45464a"
  ink-3: "#6a6c70"
  tissue: "#f1f2ef"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontWeight: 800
    lineHeight: 0.92
    textTransform: uppercase
  field-label:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.14em"
  body:
    fontFamily: "Barlow, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "JetBrains Mono, Cascadia Mono, monospace"
    fontSize: "13px"
rounded:
  box: "2px"
  window: "10px"
components:
  box-end:
    backgroundColor: "{colors.box}"
    rounded: "{rounded.box}"
  label:
    backgroundColor: "{colors.label}"
    textColor: "{colors.ink}"
  button-primary:
    backgroundColor: "{colors.box}"
    textColor: "#ffffff"
---

# Design System: Ovalwork Running

## Overview

A fictional specialist running shop, the merchant the demo agent buys from. Persuade surface. The world is a **stockroom wall**: one committed box-board orange owns the page in whole regions, box ends stand on dark steel shelves, and every box carries a white printed label with ruled fields. The point it makes for Provenant: the store prints exactly the facts (colour, size, style, price, delivery) that its JSON-LD publishes and that an agent snapshots.

All fonts are self-hosted from `@fontsource` packages through `/fonts/:file`. Product images are synthetic SVG illustrations rendered to PNG by `src/art.ts`; there are no photographs.

## Colors

- **Box / box-lit / box-deep / box-ink**: the box board, its lit top edge, the box interior and printed ink on the board. Used at region scale (box ends, the opened box, the search button), never as small scattered accents.
- **Steel family**: top bar, shelves, footer, code panel.
- **Wall**: the page ground behind the shelves (cool grey, not cream).
- **Label / ink family**: printed labels and their text. Secondary text stays in the ink family.

## Typography

- **Barlow Condensed** (600–800, uppercase): wordmark, model names, field values, big size numerals, prices. Field labels are 11px caps at 0.14em tracking printed above their values.
- **Barlow**: body copy and descriptions.
- **JetBrains Mono**: SKUs, bay numbers and the JSON-LD panel only. Tabular figures on globally.

## Layout

Container max 1360px with fluid gutters (16–40px). The home page is a short shelf header (headline, one line of copy, aisle tabs) and then the wall: an auto-fill grid of 270px+ slots with no column gap, so each slot's shelf strip joins into one continuous steel shelf. Boxes stretch to the row height and labels pin price and barcode to the bottom. The product page is two columns (opened box, sticky; big label) from 900px, one column below.

## Elevation & Depth

Depth is physical: shelf strips with a soft drop shadow, inset light on box tops, inner shadow inside the box window and the opened box. A box pulled from the shelf (hover/focus) rises 8px with a deeper soft shadow. No glass, no gradients as decoration, no hard offset shadows.

## Components

### Box end
Orange board with a lid band, a die-cut window showing the product on tissue (bay number in the corner), and the label: model name and SKU over a 2px ink rule, the descriptive title, a 2×2 field grid (colour with swatch, size, style, delivery), then price and a SKU-derived barcode.

### Opened box (product page)
The lid lifts and leans back once on arrival (1.1s exponential ease-out; none under reduced motion) while the product rises on its tissue. The front wall carries the stencilled brand and bay · SKU.

### Big label
Model name, SKU, title, description, price bar with the delivery promise, the facts table (`td[data-attr]`, `[data-price]` kept for agents), the size rail (every size shown: current solid, stocked outlined, unstocked struck and faint), colour options, and a disclosure showing the page's JSON-LD.

### Aisle tabs and search
2px ink-bordered tabs with counts; current tab inverts. Search filters the wall live in the browser and server-side on submit (`?q=`, `?aisle=`).

## Do's and Don'ts

### Do:
- Keep every agent-read fact visible on the box and identical to the JSON-LD.
- Label the shop as a demo merchant with synthetic products.
- Keep orange at region scale.

### Don't:
- Don't invent ratings, reviews, stock levels or customers.
- Don't use PayPal's logo or imply the shop is a PayPal property.
- Don't add cards with shadows or kicker labels above headings.

Raster provenance: every product and buyer-photo PNG is rendered at runtime from the SVG drawings in `src/art.ts` (synthetic, deterministic); no generated or stock imagery ships.
