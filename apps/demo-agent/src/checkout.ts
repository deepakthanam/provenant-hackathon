import type { Env } from '@provenant/config';
import { createRemoteBuyer, createRemotePayPal, type Order, type PayPalClient } from '@provenant/paypal';
import { type Provenant, withProvenantCustomId } from '@provenant/sdk';

export interface LineItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: string;
}

export interface Checkout {
  readonly label: string;
  readonly paypal: PayPalClient;
  /** Creates the PayPal order with custom_id = bundle id and seals the bundle to it. */
  createOrderAndSeal(bundleId: string, items: LineItem[], total: string): Promise<Order>;
  /** Gets payer approval: simulated in mock mode, a human in the sandbox. */
  approve(order: Order, log: (s: string) => void): Promise<void>;
  capture(orderId: string): Promise<Order>;
}

function orderLink(order: Order): string | undefined {
  return order.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
}

/** Mock mode: Provenant's mock PayPal over HTTP; the mock buyer approves instantly. */
function mockCheckout(env: Env, pv: Provenant): Checkout {
  const paypal = createRemotePayPal(env);
  const buyer = createRemoteBuyer(env)!;
  return {
    label: 'mock PayPal (HTTP, /mock-paypal)',
    paypal,
    async createOrderAndSeal(bundleId, items, total) {
      const { customId } = await pv.prepareOrder(bundleId);
      const order = await paypal.createOrder({
        custom_id: customId,
        amount: { currency_code: 'USD', value: total },
        items: items.map((i) => ({
          name: i.name,
          sku: i.sku,
          quantity: String(i.quantity),
          unit_amount: { currency_code: 'USD', value: i.unitPrice },
          category: 'PHYSICAL_GOODS',
        })),
      });
      await pv.sealOrder(bundleId, { paypalOrderId: order.id });
      return order;
    },
    async approve(order, log) {
      log(`buyer approves at ${orderLink(order) ?? '(mock)'}`);
      await buyer.approveOrder(order.id);
    },
    capture: (orderId) => paypal.captureOrder(orderId),
  };
}

type ToolkitTool = { execute: (args: unknown, options?: unknown) => Promise<unknown> };

/**
 * Sandbox mode: PayPal's Agent Toolkit creates and captures the order. Its create_order tool has
 * no custom_id parameter, so withProvenantCustomId patches the order and seals the bundle.
 */
async function toolkitCheckout(env: Env, pv: Provenant): Promise<Checkout> {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET)
    throw new Error('sandbox mode needs PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET');
  const { PayPalAgentToolkit } = await import('@paypal/agent-toolkit/ai-sdk');
  const toolkit = new PayPalAgentToolkit({
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
    configuration: {
      actions: { orders: { create: true, get: true, capture: true } },
      context: { sandbox: true },
    },
  });
  const tools = toolkit.getTools() as unknown as Record<string, ToolkitTool>;
  const paypal = createRemotePayPal(env);
  let currentBundle = '';
  const createOrder = withProvenantCustomId(tools.create_order!, {
    pv,
    setOrderCustomId: (orderId, customId) => paypal.setOrderCustomId(orderId, customId),
    currentBundleId: () => currentBundle,
  });
  const toolOptions = { toolCallId: 'provenant-demo-agent', messages: [] };
  const parse = (r: unknown) => {
    const obj = (typeof r === 'string' ? JSON.parse(r) : r) as Order & { error?: { message: string } };
    if (obj.error) throw new Error(`Agent Toolkit: ${obj.error.message}`);
    return obj;
  };
  return {
    label: 'PayPal sandbox via Agent Toolkit',
    paypal,
    async createOrderAndSeal(bundleId, items, _total) {
      currentBundle = bundleId;
      const result = await createOrder.execute(
        {
          currencyCode: 'USD',
          items: items.map((i) => ({
            name: i.name,
            description: i.sku,
            quantity: i.quantity,
            itemCost: Number(i.unitPrice),
            taxPercent: 0,
            itemTotal: Number(i.unitPrice) * i.quantity,
          })),
          returnUrl: `${env.DEMO_STORE_URL}/`,
          cancelUrl: `${env.DEMO_STORE_URL}/`,
        },
        toolOptions,
      );
      return paypal.getOrder(parse(result).id);
    },
    async approve(order, log) {
      log(`open this link and pay as your sandbox personal account:\n    ${orderLink(order)}`);
      const deadline = Date.now() + 10 * 60_000;
      while (Date.now() < deadline) {
        const s = (await paypal.getOrder(order.id)).status;
        if (s === 'APPROVED' || s === 'COMPLETED') return;
        await new Promise((r) => setTimeout(r, 3000));
      }
      throw new Error('order was not approved within 10 minutes');
    },
    async capture(orderId) {
      parse(await tools.pay_order!.execute({ id: orderId }, toolOptions));
      return paypal.getOrder(orderId);
    },
  };
}

export async function createCheckout(env: Env, pv: Provenant): Promise<Checkout> {
  return env.PAYPAL_MODE === 'sandbox' ? toolkitCheckout(env, pv) : mockCheckout(env, pv);
}
