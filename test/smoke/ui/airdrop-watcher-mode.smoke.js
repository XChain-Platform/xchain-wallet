// Smoke for §20 / Cluster X Step 10 — AirdropForm watcher-mode block.
//
// AIRDROP is a two-phase action — broadcast LIST, wait for indexer to
// confirm, then broadcast AIRDROP referencing the indexed list's
// ACTION_INDEX. The index-wait step is fundamentally incompatible with
// the watcher-mode contract (the wallet that builds the PSBT does not
// observe the broadcast). Form blocks in watcher mode with a redirect
// rather than wedge in a partial flow that would strand the user
// mid-LIST.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const formSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'AirdropForm.jsx'),
    'utf8',
);

assert.match(formSrc, /import \{ useWalletMode \} from '\.\.\/hooks\/useWalletMode\.js';/);
assert.match(formSrc, /const \{ isWatcherMode \} = useWalletMode\(\);/);
assert.match(formSrc, /Not available in watcher mode/);
assert.match(formSrc, /two-phase action/);
assert.match(
    formSrc,
    /if \(isWatcherMode\) \{[\s\S]+?Not available in watcher mode/,
    'watcher-mode block fires before the stage-based returns',
);
// AIRDROP form should NOT call buildActionPsbtRequest — the action is
// blocked entirely, not split.
assert.doesNotMatch(
    formSrc,
    /messaging\.buildActionPsbtRequest\(/,
    'AirdropForm intentionally does NOT route through buildActionPsbtRequest',
);

console.log('airdrop-watcher-mode smoke OK');
