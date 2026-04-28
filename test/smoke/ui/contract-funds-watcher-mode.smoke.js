// Smoke for §20 / Cluster X Step 18 — ContractFundsForm watcher-mode
// branch (DEPOSIT / WITHDRAW depending on mode).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const formSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'ContractFundsForm.jsx'),
    'utf8',
);

assert.match(formSrc, /import \{ useWalletMode \} from '\.\.\/hooks\/useWalletMode\.js';/);
assert.match(formSrc, /import \{ WatcherResultPanel \} from '\.\.\/components\/WatcherResultPanel\.jsx';/);
assert.match(formSrc, /const \{ isWatcherMode \} = useWalletMode\(\);/);
assert.match(formSrc, /const action = isDeposit \? 'DEPOSIT' : 'WITHDRAW';/);
assert.match(formSrc, /messaging\.buildActionPsbtRequest\(\{[\s\S]+?action, params: actionParams/);
assert.match(formSrc, /Build unsigned PSBT/);
console.log('contract-funds-watcher-mode smoke OK');
