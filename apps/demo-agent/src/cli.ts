/**
 * pnpm agent "black running shoes size 10 under $90, ask me above $50" [--yes] [--user usr_alice]
 */
import { createInterface } from 'node:readline/promises';
import { loadEnv } from '@provenant/config';
import { runPurchase } from './purchase';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const yes = args.includes('--yes') ? (args.splice(args.indexOf('--yes'), 1), true) : false;
const userRef = flag('--user');
const request = args.join(' ').trim();
if (!request) {
  console.error(
    'usage: pnpm agent "black running shoes size 10 under $90, ask me above $50" [--yes] [--user usr_x]',
  );
  process.exit(1);
}

const env = loadEnv();
console.log(`\nProvenant demo agent · PayPal ${env.PAYPAL_MODE} · LLM ${env.LLM_PROVIDER}\n"${request}"\n`);

const askUser = async (q: string) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`  ? ${q} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(a.trim());
};

try {
  const r = await runPurchase(env, { request, userRef, confirm: yes ? 'auto' : 'prompt', askUser });
  console.log(`\nDone. Order ${r.orderId} · capture ${r.captureId} · $${r.amount.value}`);
  console.log(
    `Bundle ${r.bundleId}  custom_id match: ${r.customIdMatches ? 'yes' : 'NO'}  integrity: ${r.verified ? 'ok' : 'FAILED'}`,
  );
  console.log(`Receipt: ${r.receiptUrl}\n`);
  process.exitCode = r.customIdMatches && r.verified ? 0 : 2;
} catch (e) {
  console.error(`\n✘ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
