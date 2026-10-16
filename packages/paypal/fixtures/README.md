# PayPal payload fixtures

These shapes come from PayPal's own documentation. They are used to check that `MockPayPal` emits payloads PayPal would recognise, and to unit-test webhook handling.

| File | Source |
| --- | --- |
| `webhook-payment-capture-completed.json` | Verbatim `webhook_event` from the postback sample in [Webhooks: REST integration](https://developer.paypal.com/api/rest/webhooks/rest/) |
| `dispute-details.json` | Verbatim "Show dispute details" sample response from [Use Disputes API](https://developer.paypal.com/platforms/disputes/handle-disputes/use-disputes-api) |
| `webhook-customer-dispute-created.json` | Envelope fields as in the capture sample (`id`, `event_version`, `create_time`, `resource_type`, `event_type`, `summary`, `resource`, `links`); `resource` is the dispute-details sample. PayPal does not publish a verbatim dispute webhook body, but its testing guide says these events carry the dispute ([Test and go live](https://developer.paypal.com/disputes/test-go-live)) |
| `webhook-customer-dispute-updated.json` | As above, `event_type` `CUSTOMER.DISPUTE.UPDATED` |
| `webhook-customer-dispute-resolved.json` | As above, with `status: RESOLVED` and a `dispute_outcome` |

Event names were checked against [Webhook event names](https://developer.paypal.com/api/rest/webhooks/event-names/).
