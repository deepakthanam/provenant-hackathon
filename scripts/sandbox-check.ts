/**
 * `pnpm sandbox:check` — exercises the real PayPal sandbox with your credentials:
 * OAuth → create order (custom_id) → PATCH custom_id → wait for buyer approval → capture →
 * tracking → list disputes. Approval needs a human: open the printed link and log in as your
 * sandbox personal account.
 */
import { loadEnv } from '@provenant/config';
import { HttpPayPal, PayPalError } from '@provenant/paypal';

const env = loadEnv();
if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
  console.error(
    'Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env first (Developer Dashboard → Apps & Credentials → Sandbox).',
  );
  process.exit(1);
}
const pp = new HttpPayPal({
  baseUrl: env.PAYPAL_API_BASE,
  clientId: env.PAYPAL_CLIENT_ID,
  clientSecret: env.PAYPAL_CLIENT_SECRET,
  webhookId: env.PAYPAL_WEBHOOK_ID,
  bnCode: env.PAYPAL_BN_CODE,
});

const step = (s: string) => console.log(`\n▶ ${s}`);
try {
  step('OAuth client-credentials token');
  await pp.accessToken();
  console.log('  ok');

  step('Create order with custom_id');
  const order = await pp.createOrder({
    custom_id: 'apb_SANDBOXCHECK',
    amount: { currency_code: 'USD', value: '1.00' },
    items: [
      {
        name: 'Provenant sandbox check',
        quantity: '1',
        unit_amount: { currency_code: 'USD', value: '1.00' },
        category: 'PHYSICAL_GOODS',
      },
    ],
  });
  console.log(`  order ${order.id} (${order.status})`);

  step('PATCH custom_id (the Agent Toolkit path)');
  await pp.setOrderCustomId(order.id, 'apb_SANDBOXCHECK_PATCHED');
  const read = await pp.getOrder(order.id);
  console.log(`  custom_id now ${read.purchase_units?.[0]?.custom_id}`);

  const approve = read.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
  step(`Approve as the sandbox buyer:\n  ${approve}`);
  const deadline = Date.now() + 15 * 60_000;
  let status = read.status;
  while (status !== 'APPROVED' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    status = (await pp.getOrder(order.id)).status;
    process.stdout.write(`  status ${status}\r`);
  }
  if (status !== 'APPROVED') throw new Error('order was not approved within 15 minutes');

  step('Capture');
  const captured = await pp.captureOrder(order.id);
  const capture = captured.purchase_units?.[0]?.payments?.captures?.[0];
  console.log(`  capture ${capture?.id} ${capture?.status}, custom_id ${capture?.custom_id}`);

  step('Add tracking');
  await pp.addTracking(order.id, {
    capture_id: capture!.id,
    tracking_number: `PVN${Date.now()}`,
    carrier: 'OTHER',
    carrier_name_other: 'Provenant Test',
    notify_payer: false,
  });
  console.log('  ok');

  step('List disputes');
  const disputes = await pp.listDisputes({ page_size: 5 });
  console.log(`  ${disputes.items.length} dispute(s) visible`);
  console.log('\n✔ sandbox check passed');
} catch (e) {
  if (e instanceof PayPalError)
    console.error(
      `\n✘ PayPal error ${e.status} ${e.errorName} debug_id=${e.debugId}\n${JSON.stringify(e.details, null, 2)}`,
    );
  else console.error('\n✘', e);
  process.exit(1);
}
