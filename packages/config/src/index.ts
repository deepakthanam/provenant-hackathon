import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import tls from 'node:tls';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/** Walks up from `start` until it finds the workspace root (the folder holding pnpm-workspace.yaml). */
export function findRepoRoot(start = process.cwd()): string {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CONSOLE_PORT: z.coerce.number().int().positive().default(3000),
  DEMO_STORE_PORT: z.coerce.number().int().positive().default(4100),
  DATABASE_URL: z.string().default('postgres://provenant:provenant@localhost:5433/provenant'),
  DATABASE_MODE: z.enum(['auto', 'embedded', 'external']).default('auto'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:4000'),
  CONSOLE_PASSWORD: optionalString,
  CONSOLE_PUBLIC_URL: z.string().default('http://localhost:3000'),
  DEMO_STORE_URL: z.string().default('http://localhost:4100'),
  DATA_DIR: z.string().optional(),

  PAYPAL_MODE: z.enum(['mock', 'sandbox']).default('mock'),
  PAYPAL_CLIENT_ID: optionalString,
  PAYPAL_CLIENT_SECRET: optionalString,
  PAYPAL_API_BASE: z.string().default('https://api-m.sandbox.paypal.com'),
  PAYPAL_WEBHOOK_ID: optionalString,
  PAYPAL_BN_CODE: optionalString,
  /** Mock mode only: deliver mock webhooks to /webhooks/paypal (false = rely on polling). */
  MOCK_PAYPAL_WEBHOOKS: z
    .string()
    .optional()
    .transform((v) => v !== 'false' && v !== '0'),
  PAYPAL_SANDBOX_BUYER_EMAIL: optionalString,
  DISPUTE_POLL_INTERVAL_SEC: z.coerce.number().int().nonnegative().default(60),

  PROVENANT_SIGNING_PRIVATE_KEY: optionalString,
  PROVENANT_SIGNING_PUBLIC_KEY: optionalString,

  PROVENANT_ADMIN_API_KEY: optionalString,
  PROVENANT_PLATFORM_API_KEY: optionalString,
  PROVENANT_MERCHANT_API_KEY: optionalString,

  LLM_PROVIDER: z.enum(['mock', 'anthropic', 'bedrock']).default('mock'),
  LLM_MODEL: z.string().default('claude-sonnet-5-5'),
  ANTHROPIC_API_KEY: optionalString,
  AWS_REGION: optionalString,
  BEDROCK_MODEL_ID: optionalString,

  AUTO_ACTION: bool,
  CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
  SHARED_FAULT_REFUND_PCT: z.coerce.number().min(0).max(100).default(50),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Loads `<repo>/.env` (without overriding real env vars) and returns the validated config. */
export function loadEnv(opts: { reload?: boolean } = {}): Env {
  if (cached && !opts.reload) return cached;
  const root = findRepoRoot();
  const file = join(root, '.env');
  if (existsSync(file)) loadDotenv({ path: file, quiet: true, override: opts.reload === true });
  // Strip inline comments like `mock   # mock | sandbox` that some editors leave behind.
  const raw: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) raw[k] = v?.replace(/\s+#.*$/, '');
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  trustSystemCertificates();
  return cached;
}

let systemCaAdded = false;

/**
 * Adds the operating system's trusted certificates to Node's defaults (Node otherwise trusts only
 * its bundled list). Antivirus HTTPS scanning and corporate proxies re-sign TLS traffic with a
 * root that only the OS trusts, which surfaces as "self-signed certificate in certificate chain"
 * on calls to the Anthropic API. Same effect as `node --use-system-ca`.
 */
function trustSystemCertificates(): void {
  if (systemCaAdded) return;
  systemCaAdded = true;
  try {
    const all = new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')]);
    tls.setDefaultCACertificates([...all]);
  } catch {
    // Older Node without these APIs: keep the bundled list.
  }
}
