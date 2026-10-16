import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export default function globalSetup() {
  const out = execSync('npx tsx apps/demo-agent/src/scenario-cli.ts remorse --no-approve', {
    cwd: repo,
    encoding: 'utf8',
  });
  const id = out.match(/buyer opened (PP-D-\d+)/)?.[1];
  if (!id) throw new Error(`scenario did not open a dispute:\n${out}`);
  process.env.SMOKE_DISPUTE_ID = id;
}
