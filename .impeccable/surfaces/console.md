# Surface brief: merchant console (`apps/console`)

Mode: Operate. Primary viewer: hackathon judges (demo video, then clicking through); secondary: a merchant's dispute operator.

## Direction contract

THESIS: Each dispute is a sealed evidence bag; the console is its label and its custody log. Refuses the fintech-dashboard default of a sidebar, grey cards and a blue accent, where a verdict looks like any other status.

OWN-WORLD: Label-white paper (#f8f7f3) and manila form panels (#e8e0c9) printed in near-black ink (#141414); clear-poly panels as faintly cool, slightly lighter fields with a single hairline sheen. Red tamper tape (#d0262d) is reserved for seals: intact tape means verified, torn tape means a failed check; the same red marks money owed (liability). Verdicts are rubber-stamped in five inks. Exhibit numbers are set in a stencil face; forms are set in Public Sans; hashes, ids and amounts in JetBrains Mono, tabular. Form fields use ruled custody-form rows with printed labels above the values.

STORY: A judge sees the queue as numbered exhibits with stamped verdicts. Opening one shows the bag label: what the agent saw beside what the buyer claims, the stamped verdict with its cited reasons, whether the seal is intact, the exact PayPal call, and an Approve control. Approving appends to the custody log, and the status changes in place.

FIRST VIEWPORT: Top band: wordmark at left; Disputes · Liability · Bundles; the PayPal mode tag at right. The queue page has a heading and one sentence, a row of verdict filter stamps with counts, then the AG Grid ledger filling the width, with an exhibit-number column and a stamp column. Row click opens a right-side label panel (about 420px). The detail page has the exhibit number large at top left, the tamper tape spanning the width under it, the stamp and confidence at right, then a two-column claim-vs-snapshot; the planned call with Approve is pinned in the right column.

FORM: Chain of custody, candidate 1 on my ordered list (my pick); seed 53216aab.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Signature interaction: the tamper tape tears (clip-path break, revealing VOID) when a bundle fails verification. It is a single authored motion, still under prefers-reduced-motion.
