# API

The live, interactive reference is served by the API at **`/docs`** (Swagger UI; JSON at `/docs/json`). A committed copy is in [`openapi.json`](openapi.json); regenerate it with `pnpm openapi`.

All `/v1` routes except the receipt and blobs take `Authorization: Bearer <key>`. Keys are created by `pnpm bootstrap` (stored as hashes):

| Key | Can |
| --- | --- |
| platform (`PROVENANT_PLATFORM_API_KEY`) | create and write its own bundles, sync captures, read its own liability |
| merchant (`PROVENANT_MERCHANT_API_KEY`) | read bundles for its offers, record fulfilment, read, adjudicate, approve and reject disputes |
| admin (`PROVENANT_ADMIN_API_KEY`) | everything (used by the console server-side) |

| Method | Path | |
| --- | --- | --- |
| POST | `/v1/bundles` | Create from a signed intent mandate |
| POST | `/v1/bundles/:id/offer` | Offer snapshot (+ image) |
| POST | `/v1/bundles/:id/decision` | Decision trace step |
| POST | `/v1/bundles/:id/confirmation` | User's signed confirmation |
| PUT | `/v1/bundles/:id/cart` | Approved cart |
| POST | `/v1/bundles/:id/prepare-order` | → `{ custom_id, amount }` |
| POST | `/v1/bundles/:id/seal` | `{ paypal_order_id }` |
| POST | `/v1/bundles/:id/capture` | Record the capture, verified against PayPal |
| POST | `/v1/bundles/:id/fulfilment` | Shipment / delivery |
| GET | `/v1/bundles` · `/v1/bundles/:id` · `/v1/bundles/by-order/:orderId` | Read (scoped) |
| GET | `/v1/bundles/:id/verify` | Integrity result |
| GET | `/v1/bundles/:id/receipt` | Buyer-readable receipt (public HTML) |
| GET | `/v1/blobs/:sha256` | Content-addressed image (public) |
| POST | `/webhooks/paypal` | PayPal webhooks (raw body, verified, idempotent) |
| GET | `/v1/disputes` · `/v1/disputes/:id` | Queue / detail with verdicts, actions and events |
| POST | `/v1/disputes/sync` | Poll PayPal now |
| POST | `/v1/disputes/:id/adjudicate` | (Re)run; `?force=true` |
| POST | `/v1/disputes/:id/approve` | `{ approved_by?, action_override? }` → executes |
| POST | `/v1/disputes/:id/reject` | `{ reason }` |
| GET | `/v1/disputes/:id/report.pdf` | Evidence PDF |
| POST | `/v1/disputes/:id/sandbox/adjudicate` · `…/sandbox/require-evidence` | Sandbox/mock helpers |
| GET | `/v1/liability` | Ledger by agent platform |
| POST | `/dev/tamper/:bundleId` · `/dev/demo-user/sign` | Development + mock mode only |
| GET | `/healthz` | Liveness and DB check |

In mock mode the server also serves PayPal's own paths under `/mock-paypal` (`/v1/oauth2/token`, `/v2/checkout/orders…`, `/v1/customer/disputes…`) and buyer simulation under `/mock-paypal/_buyer`.

The Postman collection in [`../postman`](../postman) runs the main flow end to end: `pnpm postman`.
