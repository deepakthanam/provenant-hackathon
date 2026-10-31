# Provenant demo video: script (under 3:00)

Target length **2:50**. The narration is about 370 words, which takes about 2:40 at a calm 140 words a minute and leaves ten seconds for clicks and pauses. The narration alone, for a teleprompter, is in [narration.txt](narration.txt).

---

## Before you record (10 minutes)

Everything below was checked against the running stack: five disputes waiting for approval, console pages loading, Claude live.

1. **Stack running.** In a terminal at the repo root:
   ```sh
   pnpm dev
   ```
   Wait for `console  http://localhost:3001`. If something is already running, run `pnpm dev:stop` first.
2. **`.env` is set for the recording:**
   - `PAYPAL_MODE=mock`: no sandbox logins mid-take.
   - `LLM_PROVIDER=anthropic`: Claude is live.
   - `DATABASE_URL=…/provenant_demo`: a clean database. Your earlier sandbox data is untouched in `provenant`.
3. **Five disputes waiting.** Open http://localhost:3001. The queue should show five disputes, all *waiting for your approval*. If it's empty, run `pnpm scenario all --no-approve` and wait about a minute.
4. **Warm up the pages** so nothing compiles on camera. Click each once:
   - the queue;
   - one dispute;
   - **Liability**;
   - **Bundles**;
   - http://localhost:4100 (the store);
   - one product page.
5. **Screen setup:**
   - **Browser:** zoom 110–125% for readability. Close other tabs, hide the bookmarks bar.
   - **Terminal:** large font (18pt+), dark theme, cleared, already at the repo root.
   - **Do not disturb on.**
6. **Rehearse the agent line once**, then press ↑ so the command is ready to re-run.

---

## Shot list and narration

| Time | Scene | On screen |
| --- | --- | --- |
| 0:00 – 0:18 | 1. The problem | Title card, or the store wall at http://localhost:4100 |
| 0:18 – 0:50 | 2. An agent buys | Store product page, then the terminal running the agent |
| 0:50 – 1:08 | 3. Disputes arrive | Console queue |
| 1:08 – 1:45 | 4. Agent overspent | Dispute: **Agent out of bounds**, then Approve, then Liability |
| 1:45 – 2:15 | 5. Wrong item | Dispute: **Merchant misrepresented** |
| 2:15 – 2:33 | 6. Tampered evidence | Dispute: **Insufficient evidence** |
| 2:33 – 2:50 | 7. Real sandbox + guardrails | Slide, or the sandbox screenshots |
| 2:50 – 3:00 | 8. Close | Title card |

### Scene 1: The problem (0:00 – 0:18)

**On screen:** title card "Provenant", then cut to the store wall.

> AI agents are starting to shop for us, and pay with PayPal. But when one of those orders is disputed, nobody can say who's at fault. Did the user change their mind? Did the agent overspend? Or did the merchant ship the wrong thing? Today, the merchant just eats the loss. Provenant fixes that.

### Scene 2: An agent buys (0:18 – 0:50)

**On screen:**
1. Store wall at http://localhost:4100, then click the **Tempo Road** box.
2. Open **"What a shopping agent reads here"** for one second.
3. Switch to the terminal and run:
   ```sh
   pnpm agent "black running shoes, size 10, under $90, check with me before spending over $50"
   ```
4. When it asks `? Buy "Road racer, black" for $65.00? It is above your $50 ask-me limit. [y/N]`, type **y** and press Enter.
5. Let the final lines show: `custom_id match: yes  integrity: ok`.

> This is Ovalwork, a demo running store. Every product page publishes the facts an agent reads. I'll ask our shopping agent, powered by Claude, for black running shoes, size ten, under ninety dollars, and to check with me above fifty. Claude turns that into a mandate I sign with my own key, compares the offers, and asks me to confirm the sixty-five dollar pair. The PayPal order carries a custom ID pointing to a sealed evidence bundle: my mandate, the exact page and image the agent saw, its reasoning, and the cart. All hash-chained and signed.

*Tip: the run takes about 6 seconds. If Claude's one-line reason is long, keep talking over it.*

### Scene 3: Disputes arrive (0:50 – 1:08)

**On screen:** console queue at http://localhost:3001. Hover slowly over the five verdict stamps.

> Later, disputes arrive from PayPal. Here are five, each already judged against its evidence bundle. Deterministic rules decide the verdict. Claude only compares the buyer's claim with what the agent actually saw.

### Scene 4: Agent overspent (1:08 – 1:45)

**On screen:**
1. Open the **$65.00 · Agent out of bounds** dispute.
2. Point at the failed check `within_max_amount: charged USD 65.00 > cap USD 50`.
3. Point at the planned PayPal call (`accept-claim`, refund) and its request body.
4. Click **Approve and send**. Pause until the timeline shows it executed.
5. Open **Liability**.

> In this one, the user capped spending at fifty, and the agent paid sixty-five without asking. The mandate check fails, so the verdict is: agent out of bounds. Here's the exact PayPal Disputes API call, accept claim with a refund. Nothing moves until I approve. *(click)* Done. The buyer is refunded, and the sixty-five dollars is booked to the agent platform's liability, not the merchant's.

### Scene 5: Wrong item (1:45 – 2:15)

**On screen:**
1. Open the **$84.00 · Merchant misrepresented** dispute.
2. Show the claim-against-snapshot panel: the listing image (black) beside the buyer's photo (blue).
3. Point at the model finding `color: listing "black", buyer reports "blue"`, citing `offer_snapshot.attributes.color`.
4. Point at the check `shipped_items_match_cart`.

> Here the buyer says the shoes arrived blue. On one side, the listing image the agent saw: black. On the other, the buyer's photo. Claude reports one material difference and cites the exact snapshot field, colour. The merchant's own shipping record agrees, so the right answer is a refund from the merchant.

*(Optional, if you're ahead of time: click **Approve and send** here too.)*

### Scene 6: Tampered evidence (2:15 – 2:33)

**On screen:** open the **Insufficient evidence** dispute. Let the torn tamper tape land, then point at the failed `ledger_verified` check.

> And if anyone edits the evidence after the fact, the hash chain breaks. The seal tears, and Provenant refuses to judge: no PayPal call, straight to human review.

### Scene 7: Real sandbox and guardrails (2:33 – 2:50)

**On screen:** a slide or screenshots of the sandbox run: `pnpm sandbox:check` passing, the Agent Toolkit order, and dispute `PP-R-DNK-10193123` judged *Within mandate* with all 17 checks passed.

> This also runs against the real PayPal sandbox: Agent Toolkit orders, captures, tracking, and a real buyer dispute picked up and judged. And throughout, the model never decides, and never moves money.

### Scene 8: Close (2:50 – 3:00)

**On screen:** title card with the repo link.

> Provenant. Sealed at purchase, judged by rules, settled through PayPal.

---

## If something goes wrong mid-take

| Problem | Fix |
| --- | --- |
| Console page is slow the first time | That's Next.js compiling; it's why step 4 warms the pages. Reload and continue. |
| Agent run fails with a connection error | Check `LLM_PROVIDER=anthropic` and the key in `.env`; Claude was verified before recording. Or record with `LLM_PROVIDER=mock`: the same flow, deterministic. |
| You approved something by mistake, or want a clean take | Switch to a fresh database. Set `DATABASE_URL=…/provenant_demo2` in `.env`, run `pnpm dev:stop`, `pnpm dev`, then `pnpm scenario all --no-approve`. |
| Ports busy after closing a terminal | `pnpm dev:stop` |

## After recording

Your pre-demo `.env` is saved as `data/env.before-demo.bak` (gitignored). To go back to sandbox mode and your earlier data:

```sh
pnpm dev:stop
cp data/env.before-demo.bak .env
```

## Captions (optional, burned in)

- 0:20 "Shopping agent powered by Claude"
- 0:40 "PayPal order · custom_id = evidence bundle"
- 1:20 "Rules decide · Claude only compares"
- 1:35 "Real PayPal Disputes API call · merchant approves"
- 2:00 "Claude finding cites offer_snapshot.attributes.color"
- 2:20 "Hash chain broken → no action"
