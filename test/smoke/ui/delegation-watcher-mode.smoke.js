// Smoke for §20 / Cluster X Step 17 — DelegationActionForm watcher-mode
// branch (DELEGATE rotate vs DELEGATE v2 revoke depending on mode; both wire to DELEGATE).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const formSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'DelegationActionForm.jsx'),
    'utf8',
);

assert.match(formSrc, /import \{ useWalletMode \} from '\.\.\/hooks\/useWalletMode\.js';/);
assert.match(formSrc, /import \{ WatcherResultPanel \} from '\.\.\/components\/WatcherResultPanel\.jsx';/);
assert.match(formSrc, /const \{ isWatcherMode \} = useWalletMode\(\);/);
assert.match(formSrc, /actionData: \{ action: 'DELEGATE'/);
assert.match(formSrc, /messaging\.buildActionPsbtRequest\(\{[\s\S]+?action, params: actionParams/);
assert.match(formSrc, /Create unsigned transaction/);
console.log('delegation-watcher-mode smoke OK');
