/** pnpm scenario <remorse|overspend|wrong-item|ambiguous|tampered|all> [--no-approve] */
import { loadEnv } from '@provenant/config';
import {
  runScenario,
  SCENARIOS,
  type ScenarioName,
  type ScenarioResult,
  type SettleResult,
  settleScenario,
} from './scenarios';

const argv = process.argv.slice(2);
const noApprove = argv.includes('--no-approve');
const arg = argv.find((a) => !a.startsWith('--')) ?? '';
const names: ScenarioName[] =
  arg === 'all' ? [...SCENARIOS] : SCENARIOS.includes(arg as ScenarioName) ? [arg as ScenarioName] : [];
if (names.length === 0) {
  console.error(`usage: pnpm scenario <${SCENARIOS.join('|')}|all> [--no-approve]`);
  process.exit(1);
}

const env = loadEnv();
const results: Array<ScenarioResult & { settled?: SettleResult }> = [];
try {
  for (const n of names) {
    const r = await runScenario(env, n);
    results.push(noApprove ? r : { ...r, settled: await settleScenario(env, r) });
  }
  if (results.length > 1) {
    console.log('');
    console.log(
      `${'Scenario'.padEnd(12)} ${'Verdict'.padEnd(25)} ${'Action'.padEnd(17)} ${'PayPal final state'.padEnd(42)} Result`,
    );
    for (const r of results) {
      const paypal = r.settled
        ? `${r.settled.status} ${r.settled.outcome ?? ''}`.trim()
        : '(awaiting approval)';
      const pass = r.ok && (r.settled?.ok ?? true);
      console.log(
        `${r.name.padEnd(12)} ${r.verdict.padEnd(25)} ${r.action.padEnd(17)} ${paypal.padEnd(42)} ${pass ? 'as expected' : 'UNEXPECTED'}`,
      );
    }
  }
  console.log('');
  console.log(
    `Console: ${env.CONSOLE_PUBLIC_URL}${noApprove ? ' (verdicts are waiting for your approval)' : ''}`,
  );
  process.exitCode = results.every((r) => r.ok && (r.settled?.ok ?? true)) ? 0 : 2;
} catch (e) {
  console.error(`\n✘ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
