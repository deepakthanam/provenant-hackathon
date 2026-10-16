# Progress

## Status

| Milestone | State |
| --- | --- |
| M0 Scaffold | ✅ done |
| M1 Evidence store | ✅ done |
| M2 PayPal client | ⏭ next |
| M3 SDK + demo store + agent | ☐ |
| M4 Dispute intake | ☐ |
| M5 Adjudicator | ☐ |
| M6 Actions | ☐ |
| M7 Console | ☐ |
| M8 MCP, Postman, docs | ☐ |
| M9 Hardening | ☐ |

## M0: what was done

- pnpm 10 workspace + Turborepo, strict TypeScript, Biome for lint/format, Vitest.
- `minimumReleaseAge: 20160` in `pnpm-workspace.yaml` means no dependency version younger than 14 days is ever resolved.
- `@provenant/config`: Zod-validated env loaded from the repo-root `.env`.
- `@provenant/db`: Drizzle schema for every table in the spec, plus `api_keys` and `kv`. The initial migration is `0000_init`.
- Postgres: `DATABASE_MODE=auto` uses `DATABASE_URL` when something is listening; otherwise it starts an **embedded Postgres 16** (`embedded-postgres` npm package, data in `./data/pg`). `infra/docker-compose.yml` is kept for Docker users.
- Scripts: `pnpm bootstrap` (install, `.env`, keys, DB, migrations), `pnpm dev`, `pnpm db`, `pnpm db:migrate`, `pnpm db:stop`, `pnpm keygen`.
- `apps/server`: Fastify + `fastify-type-provider-zod`, `/healthz` (with a DB check), OpenAPI UI at `/docs`.
- `apps/console`: Next.js App Router + Tailwind 4 shell showing API health.
- `apps/demo-store`: placeholder Fastify server.

Checks: `curl localhost:4000/healthz` returns `{"status":"ok","db":"ok","paypal_mode":"mock"}`; the console renders "API healthy"; `pnpm test`, `pnpm typecheck` and `pnpm lint` are green.

## M1: what was done

- `@provenant/schemas`: Zod schemas for money, the intent mandate, confirmation, cart, offer snapshot, decision trace, fulfilment, the evidence bundle, ledger events, API requests and verdicts.
- `@provenant/evidence`:
  - canonical JSON (sorted keys, no whitespace; non-JSON values are rejected, not dropped), SHA-256 `sha256:<hex>` hashes, and Ed25519 `ed25519:<b64>` signatures using `node:crypto` only.
  - A pure event reducer. Bundles move `OPEN` → `SEALED` → `FULFILLED`, and agent evidence is frozen after sealing.
  - A global hash chain in `bundle_events`. Every row's `prev_hash` is the previous row of the whole ledger, and appends are serialised with a Postgres advisory lock.
  - `verify(bundleId)` checks each row's hash, Provenant's signature on each row, the links to the previous and next row, a replay against the materialised `bundles` row, the user's mandate and confirmation signatures, and the snapshot image's hash.
  - A content-addressed `LocalBlobStore` (`data/blobs/<sha256>`) behind a `BlobStore` interface, ready for S3 later.
- Server: Bearer API keys (stored as SHA-256 hashes) for admin / platform / merchant, with scoping rules. Routes: `POST /v1/bundles`, `…/offer`, `…/decision`, `…/confirmation`, `PUT …/cart`, `…/prepare-order`, `…/seal`, `…/fulfilment`, `GET /v1/bundles/:id`, `…/verify`, `/v1/bundles/by-order/:orderId`, the public `…/receipt` (HTML) and `/v1/blobs/:sha256`. Every error has the shape `{error, message, request_id}`, and `x-request-id` is echoed.
- `pnpm bootstrap` generates the three API keys into `.env`. The server seeds the demo platform, merchant and key hashes on every start.
- Tests: the root `vitest.config.ts` runs every package as a project. One global setup starts or reuses Postgres, and each suite gets its own throwaway database. 43 tests cover canonicalisation, signatures, the reducer, chain linearity under concurrent appends, tamper detection (edited row, edited materialised row, deleted row, swapped image), forged mandates, double-sealing, auth scoping, validation, receipt escaping, and `/healthz`.

Checks: editing a `bundle_events` row or a `bundles` row makes `verify` fail (tested). A live run against `pnpm dev` gives create → verify ok → receipt 200.

## Next (M2)

PayPal client interface; `MockPayPal` (Postgres `mock_` tables, dispute lifecycle, webhook emission using fixtures copied from PayPal's docs); `SandboxPayPal` (OAuth with caching, Orders, Disputes, webhook verification, retries, typed errors); contract tests run against both.

## Deviations from the spec

| # | Spec | What we do | Why |
| --- | --- | --- | --- |
| D1 | Agent Toolkit create-order wrapper injects `custom_id` | Create with the toolkit, then `PATCH` the order to set `purchase_units[0].custom_id`; `sealOrder` checks it is present | The toolkit's `create_order` (`@paypal/agent-toolkit@1.11.0`) builds `purchase_units` itself and has no `custom_id` parameter |
| D2 | The agent "creates and captures" sandbox orders | Sandbox needs payer approval (approve link → sandbox buyer login) before capture; an `--auto-approve` option will drive it with Playwright | Orders v2 `intent: CAPTURE` requires payer approval |
| D3 | `sandboxCreateDispute` | Implemented, but expect 403; fallback is the sandbox buyer opening a dispute in the UI, picked up by polling | `POST /v1/customer/disputes` is not in the public schema; it needs a `DISPUTE_CREATE` scope from an account manager plus a `PayPal-Auth-Assertion` JWT |
| D4 | SHARED_FAULT at INQUIRY: "make-offer, partial refund" | `make-offer` with `offer_type: REFUND` and `offer_amount` = `SHARED_FAULT_REFUND_PCT` of the dispute amount | The `offer_type` enum has no `PARTIAL_REFUND` (it exists only for `accept-claim`) |
| D5 | Action chosen from HATEOAS links | Also checks `allowed_response_options` for `accept_claim_type` / `offer_type` | PayPal docs say allowed values come from there |
| D6 | `pnpm setup` | `pnpm bootstrap` (the `setup` script also exists; run it as `pnpm run setup`) | `pnpm setup` is a pnpm built-in that edits the user's PATH; it never runs a package script |
| D7 | Postgres 16 via Docker Compose | Embedded Postgres 16 by default, Compose optional | No Docker needed on a fresh clone |
| D8 | `DATABASE_URL` on port 5432 | Port 5433 | Avoids clashing with a locally installed Postgres |
| D9 | Layout lists no `db`/`config` packages | Added `packages/db` and `packages/config` | Server, PayPal mock, adjudicator and scripts all share the schema and env |
| D10 | Node 22 LTS | `engines: >=22`; developed on Node 24 | Backward compatible |
| D11 | — | Multipart field names follow the schema exactly: `evidence-file`, `accept-claim-document`, `message_document`, `supporting document` | From the Disputes v1 schema |
| D12 | Users are not covered by the API list | Trust-on-first-use: `POST /v1/bundles` accepts `user_public_key` for a new `user_ref` and rejects a different key later | The spec needs per-user mandate signatures but lists no user endpoint |
| D13 | Bundle API list | Added `POST /v1/bundles/:id/fulfilment`, `GET /v1/bundles/by-order/:orderId` and the public `GET /v1/blobs/:sha256` | The spec has a "add fulfilment" event but no route; the console and webhook processing need lookup by order and images |
| D14 | Bundle shape | Added `captured_amount`, `created_at`, `sealed_at`, `user_confirmation.amount` and `fulfilment.shipped_items` / `shipped_at` | The rules need the captured amount and the amount the user confirmed; the wrong-item scenario needs what actually shipped |
| D15 | Receipt "merchant/platform scoped" | `/receipt` is public by bundle id | The buyer has no API key. Ids carry 80 random bits, and bundles hold no names or emails |
| D16 | `bundle_sig` | `hash` / `prev_hash` / `bundle_sig` on a bundle are its latest ledger row's hash, that row's `prev_hash`, and Provenant's signature over that hash | Makes "the bundle's signature" a single checkable value tied to the chain |

## Known local quirks (Windows)

- Killing `pnpm dev` hard (not with Ctrl+C) can orphan the embedded Postgres; run `pnpm db:stop`.
