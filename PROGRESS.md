# Progress

## Status

| Milestone | State |
| --- | --- |
| M0 Scaffold | ✅ done |
| M1 Evidence store | ⏭ next |
| M2 PayPal client | ☐ |
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

## Next (M1)

`packages/schemas` (bundle, mandate and verdict Zod schemas), `packages/evidence` (canonical JSON, SHA-256, Ed25519, global hash chain, `verifyBundle`, blob store), the bundle API routes and API-key auth, and seed data.

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

## Known local quirks (Windows)

- Killing `pnpm dev` hard (not with Ctrl+C) can orphan the embedded Postgres; run `pnpm db:stop`.
