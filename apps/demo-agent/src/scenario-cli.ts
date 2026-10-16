/** pnpm scenario <remorse|overspend|wrong-item|ambiguous|tampered|all> */
import { loadEnv } from '@provenant/config';
import { runScenario, SCENARIOS, type ScenarioName, type ScenarioResult } from './scenarios';

const arg = process.argv[2] ?? '';
const names: ScenarioName[] =
  arg === 'all' ? [...SCENARIOS] : SCENARIOS.includes(arg as ScenarioName) ? [arg as ScenarioName] : [];
if (names.length === 0) {
  console.error(`usage: pnpm scenario <${SCENARIOS.join('|')}|all>`);
  process.exit(1);
}

const env = loadEnv();
const results: ScenarioResult[] = [];
try {
  for (const n of names) results.push(await runScenario(env, n));
  if (results.length > 1) {
    console.log('\nScenario          Verdict                    Action              Result');
    for (const r of results)
      console.log(
        `${r.name.padEnd(17)} ${r.verdict.padEnd(26)} ${r.action.padEnd(19)} ${r.ok ? 'as expected' : `EXPECTED ${r.expected.verdict}`}`,
      );
  }
  console.log(`\nOpen the console at ${env.CONSOLE_PUBLIC_URL} to review and approve.`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 2;
} catch (e) {
  console.error(`\n✘ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
