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

## Licence

[MIT](LICENSE)
