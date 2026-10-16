import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
  verify,
} from 'node:crypto';
import type { Money, UnsignedIntentMandate } from '@provenant/schemas';
import { canonicalize } from './canonical';

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** `sha256:<hex>` of the canonical JSON form of `value`. */
export function hashCanonical(value: unknown): string {
  return `sha256:${sha256Hex(canonicalize(value))}`;
}

const SIG_PREFIX = 'ed25519:';

/** Keys travel as base64 of their PEM text, so they fit on one .env line. */
export function publicKeyFromB64(b64: string): KeyObject {
  const key = createPublicKey(Buffer.from(b64, 'base64').toString('utf8'));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('expected an Ed25519 public key');
  return key;
}

export function privateKeyFromB64(b64: string): KeyObject {
  const key = createPrivateKey(Buffer.from(b64, 'base64').toString('utf8'));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('expected an Ed25519 private key');
  return key;
}

export function generateKeyPairB64(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()).toString(
      'base64',
    ),
    publicKey: Buffer.from(publicKey.export({ type: 'spki', format: 'pem' }).toString()).toString('base64'),
  };
}

/** Short stable id for a public key: first 16 hex chars of SHA-256 over its SPKI DER. */
export function fingerprint(key: KeyObject): string {
  return sha256Hex(key.export({ type: 'spki', format: 'der' })).slice(0, 16);
}

export function signMessage(privateKey: KeyObject, message: string): string {
  return SIG_PREFIX + sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64');
}

export function verifyMessage(publicKey: KeyObject, message: string, sig: string): boolean {
  if (!sig.startsWith(SIG_PREFIX)) return false;
  try {
    return verify(
      null,
      Buffer.from(message, 'utf8'),
      publicKey,
      Buffer.from(sig.slice(SIG_PREFIX.length), 'base64'),
    );
  } catch {
    return false;
  }
}

/** Provenant's own signing identity (signs every ledger row's hash). */
export class Signer {
  readonly publicKey: KeyObject;
  readonly fingerprint: string;

  constructor(private readonly privateKey: KeyObject) {
    this.publicKey = createPublicKey(privateKey);
    this.fingerprint = fingerprint(this.publicKey);
  }

  static fromB64(privateKeyB64: string | undefined): Signer {
    if (!privateKeyB64) {
      throw new Error('PROVENANT_SIGNING_PRIVATE_KEY is not set. Run `pnpm keygen`.');
    }
    return new Signer(privateKeyFromB64(privateKeyB64));
  }

  sign(message: string): string {
    return signMessage(this.privateKey, message);
  }

  verify(message: string, sig: string): boolean {
    return verifyMessage(this.publicKey, message, sig);
  }
}

/** The exact bytes a user signs to authorise a mandate: canonical JSON bound to their user_ref. */
export function mandateSigningMessage(userRef: string, mandate: UnsignedIntentMandate): string {
  return canonicalize({ purpose: 'provenant.intent_mandate.v1', user_ref: userRef, mandate });
}

/** The exact bytes a user signs to confirm a purchase above `confirm_above`. */
export function confirmationSigningMessage(bundleId: string, amount: Money, givenAt: string): string {
  return canonicalize({
    purpose: 'provenant.user_confirmation.v1',
    bundle_id: bundleId,
    amount,
    given_at: givenAt,
  });
}

/** User-side helper: sign a mandate with the user's key (demo agents hold a per-user keypair). */
export function signMandate(
  userPrivateKeyB64: string,
  userRef: string,
  mandate: UnsignedIntentMandate,
): string {
  return signMessage(privateKeyFromB64(userPrivateKeyB64), mandateSigningMessage(userRef, mandate));
}

/** User-side helper: sign a purchase confirmation for `amount`. */
export function signConfirmation(
  userPrivateKeyB64: string,
  bundleId: string,
  amount: Money,
  givenAt: string,
): string {
  return signMessage(
    privateKeyFromB64(userPrivateKeyB64),
    confirmationSigningMessage(bundleId, amount, givenAt),
  );
}
