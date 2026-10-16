/**
 * pnpm replay <verdictId> — re-runs a stored verdict on exactly the inputs it was made from
 * (images restored from the content-addressed blob store) and reports what changed.
 * With LLM_PROVIDER=mock the result must be identical; with a real model, findings may vary and
 * the deterministic rules decide whether that changes the verdict.
 */
import { join } from 'node:path';
import {
  adjudicate,
  CLAIM_TASK,
  inputsHash,
  mockClaimHandler,
  rehydrateInputs,
  type StoredInputs,
} from '@provenant/adjudicator';
import { findRepoRoot, loadEnv } from '@provenant/config';
import { createDb, verdicts } from '@provenant/db';
import { LocalBlobStore } from '@provenant/evidence';
import { createLlm } from '@provenant/llm';
import { eq } from 'drizzle-orm';
import { bootDatabase } from './lib/stack';

const id = process.argv[2];
if (!id) {
  console.error('usage: pnpm replay <verdictId>');
  process.exit(1);
}

const pg = await bootDatabase();
const env = loadEnv();
const db = createDb(env.DATABASE_URL, { max: 2 });
try {
  const [v] = await db.select().from(verdicts).where(eq(verdicts.id, id));
  if (!v) throw new Error(`verdict ${id} not found`);
  const blobs = new LocalBlobStore(env.DATA_DIR ?? join(findRepoRoot(), 'data'));
  const input = await rehydrateInputs(v.inputs as StoredInputs, (sha) => blobs.get(sha));
  const sameInputs = inputsHash(input) === v.inputsHash;
  const llm = createLlm(env, { [CLAIM_TASK]: mockClaimHandler });
  const r = await adjudicate(input, llm);

  const row = (label: string, before: unknown, after: unknown) =>
    console.log(
      `  ${label.padEnd(16)} ${String(before).padEnd(34)} ${String(after).padEnd(34)} ${before === after ? '' : '← changed'}`,
    );
  console.log(`\nReplay of ${id} (dispute ${v.disputeId})\n`);
  console.log(`  ${''.padEnd(16)} ${'stored'.padEnd(34)} replay`);
  row('inputs hash', v.inputsHash.slice(0, 30), r.inputsHash.slice(0, 30));
  row('model', v.modelId ?? '-', r.model?.modelId ?? '-');
  row('prompt hash', (v.promptHash ?? '-').slice(0, 30), (r.model?.promptHash ?? '-').slice(0, 30));
  row('verdict', v.verdict, r.verdict);
  row('confidence', Number(v.confidence).toFixed(3), r.confidence.toFixed(3));
  row('planned action', (v.recommendedAction as { kind: string }).kind, r.plannedAction.kind);
  row('findings', (v.modelFindings as unknown[]).length, r.model?.findings.length ?? 0);
  const same =
    sameInputs &&
    v.verdict === r.verdict &&
    (v.recommendedAction as { kind: string }).kind === r.plannedAction.kind;
  console.log(
    `\n${same ? '✔ replay reproduces the stored verdict' : '✘ replay differs from the stored verdict'}${sameInputs ? '' : ' (inputs differ: blobs changed?)'}\n`,
  );
  process.exitCode = same ? 0 : 2;
} catch (e) {
  console.error(`✘ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await db.$client.end();
  await pg.stop();
}
