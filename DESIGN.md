---
name: Provenant console
description: Chain of custody. Each dispute is a sealed evidence bag; the console is its label and custody log.
colors:
  paper: "#f8f7f3"
  paper-2: "#f1efe8"
  manila: "#e8e0c9"
  manila-2: "#d9cfb2"
  rule: "#cfc6ad"
  poly: "#eef2f3"
  poly-edge: "#c9d3d6"
  ink: "#141414"
  ink-2: "#4a4944"
  ink-3: "#6d6b63"
  tape: "#d0262d"
  tape-ink: "#fff7f2"
  verdict-within: "#1f6b45"
  verdict-agent: "#b3261e"
  verdict-merchant: "#9a5208"
  verdict-shared: "#3b4aa0"
  verdict-insufficient: "#4a4944"
typography:
  exhibit:
    fontFamily: "Saira Stencil, Public Sans, sans-serif"
    fontSize: "56px"
    fontWeight: 600
    lineHeight: 0.95
    letterSpacing: "0.02em"
  page-title:
    fontFamily: "Public Sans, Segoe UI, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  part-title:
    fontFamily: "Public Sans, Segoe UI, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Public Sans, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  field-label:
    fontFamily: "Public Sans, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.08em"
  data:
    fontFamily: "JetBrains Mono, Cascadia Mono, monospace"
    fontSize: "13.5px"
    fontWeight: 400
rounded:
  stamp: "3px"
  control: "3px"
  stamp-lg: "4px"
spacing:
  gutter: "32px"
  part-gap: "40px"
  row: "54px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  panel-form:
    backgroundColor: "{colors.manila}"
    textColor: "{colors.ink}"
  panel-poly:
    backgroundColor: "{colors.poly}"
    textColor: "{colors.ink}"
---

# Design System: Provenant console

## Overview

Operate surface for hackathon judges and merchant dispute operators. The world is a forensic **chain of custody**: label paper, manila custody forms, clear-poly evidence panels, near-black ink, red tamper tape. The aim is that each dispute reads like a sealed exhibit, with its number, its seal, what was inside, and who touched it, rather than like a row in a fintech dashboard. It is light-themed because the scene is a lit room and a projector.

## Colors

- **Paper / paper-2**: page ground and secondary fields.
- **Manila / manila-2**: form headers (grid header, decision rail header), selected and hover states.
- **Poly / poly-edge**: the "what the agent saw" panel and empty states. A cool, clear field with a 1px top sheen.
- **Ink / ink-2 / ink-3**: text, rules and secondary text. No grey text on coloured fields; secondary text stays in this ink family.
- **Tape**: reserved. It marks the **seal** (intact tape = verified, torn tape = a failed check), **money owed** (liability totals, refunds booked against a platform), and **"waiting for your approval"**. It is never used as decoration.
- **Verdict inks**: five stamp inks, one per verdict. A stamp carries its ink as text and border on a 7% tint; Insufficient evidence adds a diagonal hatch.

## Typography

- **Saira Stencil** is used only for the wordmark, exhibit numbers (dispute ids as headlines) and the tape's legends.
- **Public Sans** (workhorse, form-like) is used for all UI text. Field labels are 11px caps at 0.08em tracking, set above their values the way custody-form labels are printed.
- **JetBrains Mono** is used for real data only: ids, hashes, amounts, timestamps, request bodies. Tabular figures are on globally.

## Layout

The container is at most 1440px wide with 32px gutters. The detail page is two columns from 1280px: the evidence on the left, and a sticky 400px decision rail on the right (the planned call, then the integrity proof). Below 1280px the rail moves above the evidence. Parts (claim against the snapshot, why, checks, mandate, custody log) are separated by 40px, each titled with a 2px ink rule. The queue is a full-width AG Grid with 54px rows, an exhibit column pinned left, columns fit to width, and a right-hand label panel (440px) on row click.

## Elevation & Depth

The surface is flat paper. Depth comes from two places only: the tape's slight drop shadow, and the label panel's soft left shadow (`-12px 0 32px rgba(20,20,20,0.12)`) over the queue. There are no card shadows.

## Shapes

Corners are at most 3–4px (stamps, controls). Panels are square. Large stamps get a double rule (an inset paper ring plus an ink ring) to read as rubber stamps.

## Components

### Buttons
Primary is solid ink, used once per decision ("Approve and send"); when there is nothing to approve it greys out and says so. Secondary has a 2px ink border with a manila hover. Tertiary has a rule-coloured border and darkens on hover.

### Verdict stamp
Uppercase, 12px (grid) or 17px (detail), in its verdict ink. Filter stamps above the queue use the same inks, inverting when active.

### Tamper tape (signature component)
A full-width red band. **Intact** shows a solid label block (SEAL INTACT · entries · chain position · signer key) over a faint repeated "EVIDENCE · SEALED · DO NOT TAMPER" legend. **Broken** shows two pieces with ragged clip-path edges that tear apart once on arrival (700ms exponential ease-out; instant under reduced motion), a VOID label in the gap, and the failed check in red below.

### Fields
A custody-form row: printed label above, value below, 1px rule beneath.

### Decision rail
A manila header (the planned call and its state), the explanation, the exact `POST /v1/customer/disputes/{id}/…` path and JSON body, attached files, refund and liability, then Approve / Override / Reject. Override and Reject open inline forms, never modals.

### Custody log
A chronological, three-column list (time · actor · event) merging the bundle, PayPal webhook and poll events, verdicts and executed calls.

## Do's and Don'ts

### Do:
- Show the exact PayPal request before anyone approves it.
- Cite the evidence field next to every reason and finding.
- Keep tape red for seals, money owed and waiting approvals only.
- Use mono for data, never for decoration.

### Don't:
- Don't add cards with shadows, gradients, glass, or coloured side-borders.
- Don't use modals for approve, override or reject.
- Don't put a kicker or eyebrow above headings (field labels above values are fine).
- Don't let the model's text read as a decision: findings are labelled as structured differences, and the verdict comes from rules.

Raster provenance: the product and buyer-photo PNGs shown in the console are generated by the demo store's own rasteriser (`apps/demo-store/src/png.ts`). They are synthetic demo images, not photographs.
