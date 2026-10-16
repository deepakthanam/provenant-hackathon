import type { BundleEventPayload, BundleState } from '@provenant/schemas';

export class BundleStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleStateError';
  }
}

export type BundleEventInput = BundleEventPayload & { bundle_id: string; created_at: string };

/**
 * Pure reducer: folds one ledger event into the bundle state. It is used both when writing
 * (to validate a transition before it is appended) and when verifying (to replay the chain).
 */
export function applyEvent(state: BundleState | null, event: BundleEventInput): BundleState {
  if (event.type === 'created') {
    if (state) throw new BundleStateError('bundle already exists');
    return {
      bundle_id: event.bundle_id,
      version: 1,
      paypal_order_id: null,
      paypal_capture_id: null,
      captured_amount: null,
      agent: event.payload.agent,
      user_ref: event.payload.user_ref,
      intent_mandate: event.payload.intent_mandate,
      user_confirmation: null,
      cart: [],
      offer_snapshot: null,
      decision_trace: [],
      fulfilment: null,
      status: 'OPEN',
      created_at: event.created_at,
      sealed_at: null,
    };
  }
  if (!state) throw new BundleStateError(`cannot apply ${event.type} before created`);

  const requireOpen = () => {
    if (state.status !== 'OPEN')
      throw new BundleStateError(`bundle is ${state.status}; ${event.type} needs OPEN`);
  };

  switch (event.type) {
    case 'offer_recorded':
      requireOpen();
      return { ...state, offer_snapshot: event.payload.offer_snapshot };
    case 'decision_recorded':
      requireOpen();
      return { ...state, decision_trace: [...state.decision_trace, event.payload.step] };
    case 'confirmation_recorded':
      requireOpen();
      return { ...state, user_confirmation: event.payload.user_confirmation };
    case 'cart_set':
      requireOpen();
      return { ...state, cart: event.payload.cart };
    case 'sealed':
      requireOpen();
      if (!state.offer_snapshot) throw new BundleStateError('cannot seal without an offer snapshot');
      if (state.cart.length === 0) throw new BundleStateError('cannot seal with an empty cart');
      return {
        ...state,
        paypal_order_id: event.payload.paypal_order_id,
        status: 'SEALED',
        sealed_at: event.created_at,
      };
    case 'capture_recorded':
      if (state.status === 'OPEN') throw new BundleStateError('cannot record a capture before sealing');
      return {
        ...state,
        paypal_capture_id: event.payload.paypal_capture_id,
        captured_amount: event.payload.amount,
      };
    case 'fulfilment_recorded':
      if (state.status === 'OPEN') throw new BundleStateError('cannot record fulfilment before sealing');
      return { ...state, fulfilment: event.payload.fulfilment, status: 'FULFILLED' };
  }
}

export function replay(events: BundleEventInput[]): BundleState {
  let state: BundleState | null = null;
  for (const e of events) state = applyEvent(state, e);
  if (!state) throw new BundleStateError('no events');
  return state;
}
