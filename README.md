# Provenant

Provenant gives every purchase an AI shopping agent makes through PayPal a signed, tamper-evident evidence bundle. When a dispute arrives, it judges the buyer's claim against that bundle and assigns fault to the agent, the merchant, both, or nobody. Each order's bundle holds the user's mandate, the approved cart, a snapshot of the offer the agent saw, and the agent's decision trace. It is linked to the PayPal order through `purchase_units[].custom_id`. After the merchant approves, Provenant takes the matching action through the PayPal Disputes API.

> Work in progress. See [PROGRESS.md](PROGRESS.md) for milestone status and deviations from the spec.

## Quick start (no credentials, no Docker)

```sh
corepack enable
pnpm bootstrap      # install, create .env, generate signing keys, start embedded Postgres, migrate
pnpm dev            # API :4000 (docs at /docs) · console :3000 · demo store :4100
```

Use `pnpm bootstrap`, not `pnpm setup`: `setup` is a pnpm built-in command.

If you'd rather use Docker for Postgres, run `docker compose -f infra/docker-compose.yml up -d` and set `DATABASE_MODE=external`.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm bootstrap` | One-time setup; safe to re-run |
| `pnpm dev` | Database + server + console + demo store |
| `pnpm db` / `pnpm db:stop` | Run / stop the embedded Postgres on its own |
| `pnpm db:migrate` | Apply migrations |
| `pnpm keygen` | Generate the Ed25519 signing keypair into `.env` |
| `pnpm test` · `pnpm typecheck` · `pnpm lint` | Quality gates |

## Receiving PayPal dispute events

Provenant accepts events two ways, and both can run at once. Processing is idempotent per PayPal event id.

1. **Webhooks**, at `POST /webhooks/paypal`. The raw body is kept byte-for-byte and verified with PayPal's `verify-webhook-signature` API (skipped only in mock mode), stored once per event id, and then processed. To receive sandbox webhooks on a laptop:
   ```sh
   cloudflared tunnel --url http://localhost:4000
   ```
   In the PayPal Developer Dashboard → your sandbox app → **Webhooks**, add `https://<random>.trycloudflare.com/webhooks/paypal` and subscribe to `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`, `CUSTOMER.DISPUTE.RESOLVED` and `PAYMENT.CAPTURE.COMPLETED`. Copy the webhook ID into `PAYPAL_WEBHOOK_ID`. Quick-tunnel URLs change on every run, so update the webhook each time.
2. **Polling** (no tunnel needed). Every `DISPUTE_POLL_INTERVAL_SEC` seconds the server lists disputes with `update_time_after` = its stored watermark and refreshes the ones that changed. `POST /v1/disputes/sync` runs a pass immediately. Set `MOCK_PAYPAL_WEBHOOKS=false` to exercise this path in mock mode.

A dispute is linked to its evidence bundle through the disputed transaction: `seller_transaction_id` is the capture id, cross-checked against `custom` (the order's `custom_id`). If the two disagree, nothing is linked.

## Licence

[MIT](LICENSE)
