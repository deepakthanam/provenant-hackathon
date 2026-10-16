import type { UnsignedIntentMandate } from '@provenant/schemas';
import { describe, expect, it } from 'vitest';
import {
  confirmationSigningMessage,
  generateKeyPairB64,
  mandateSigningMessage,
  publicKeyFromB64,
  Signer,
  signConfirmation,
  signMandate,
  verifyMessage,
} from '../src/crypto';

const mandate: UnsignedIntentMandate = {
  text: 'Buy black running shoes, size 10, under $90.',
  max_amount: { value: '90.00', currency: 'USD' },
  confirm_above: { value: '50.00', currency: 'USD' },
  allowed_categories: ['footwear'],
  allowed_merchants: ['demo-store'],
  expires_at: '2026-11-30T00:00:00Z',
};

describe('Ed25519 signing', () => {
  const keys = generateKeyPairB64();
  const signer = Signer.fromB64(keys.privateKey);

  it('signs and verifies a message', () => {
    const sig = signer.sign('sha256:abc');
    expect(sig).toMatch(/^ed25519:/);
    expect(signer.verify('sha256:abc', sig)).toBe(true);
    expect(signer.verify('sha256:abd', sig)).toBe(false);
  });

  it('rejects signatures from another key', () => {
    const other = Signer.fromB64(generateKeyPairB64().privateKey);
    expect(signer.verify('m', other.sign('m'))).toBe(false);
  });

  it('rejects malformed signatures without throwing', () => {
    expect(signer.verify('m', 'ed25519:not-base64!!')).toBe(false);
    expect(signer.verify('m', 'rsa:AAAA')).toBe(false);
  });

  it('derives a stable fingerprint from the public key', () => {
    expect(signer.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(Signer.fromB64(keys.privateKey).fingerprint).toBe(signer.fingerprint);
  });

  it('explains a missing key', () => {
    expect(() => Signer.fromB64(undefined)).toThrow(/pnpm keygen/);
  });
});

describe('user signatures', () => {
  const user = generateKeyPairB64();
  const pub = publicKeyFromB64(user.publicKey);

  it('binds the mandate signature to the user ref and every mandate field', () => {
    const sig = signMandate(user.privateKey, 'usr_alice', mandate);
    expect(verifyMessage(pub, mandateSigningMessage('usr_alice', mandate), sig)).toBe(true);
    expect(verifyMessage(pub, mandateSigningMessage('usr_bob', mandate), sig)).toBe(false);
    const raised = { ...mandate, max_amount: { value: '900.00', currency: 'USD' } };
    expect(verifyMessage(pub, mandateSigningMessage('usr_alice', raised), sig)).toBe(false);
  });

  it('binds a confirmation to bundle, amount and time', () => {
    const amount = { value: '84.00', currency: 'USD' };
    const sig = signConfirmation(user.privateKey, 'apb_1', amount, '2026-10-16T10:00:00.000Z');
    expect(
      verifyMessage(pub, confirmationSigningMessage('apb_1', amount, '2026-10-16T10:00:00.000Z'), sig),
    ).toBe(true);
    expect(
      verifyMessage(
        pub,
        confirmationSigningMessage('apb_1', { value: '99.00', currency: 'USD' }, '2026-10-16T10:00:00.000Z'),
        sig,
      ),
    ).toBe(false);
  });
});
