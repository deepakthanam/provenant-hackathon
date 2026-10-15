/** `pnpm db:stop`: shut down an embedded Postgres orphaned by a hard-killed `pnpm dev`. */
import { findRepoRoot } from '@provenant/config';
import { stopOrphanedEmbedded } from '@provenant/db/embedded';

console.log(await stopOrphanedEmbedded(findRepoRoot()));
