// Smoke for §20 / Cluster X Step 12 — LinkForm watcher-mode branch.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const formSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'LinkForm.jsx'),
    'utf8',
);

assert.match(formSrc, /import \{ useWalletMode \} from '\.\.\/hooks\/useWalletMode\.js';/);
assert.match(formSrc, /import \{ WatcherResultPanel \} from '\.\.\/components\/WatcherResultPanel\.jsx';/);
assert.match(formSrc, /const \{ isWatcherMode \} = useWalletMode\(\);/);
assert.match(
    formSrc,
    /messaging\.buildActionPsbtRequest\(\{[\s\S]+?action: 'LINK'/,
);
assert.match(formSrc, /COIN1: String\(ticker1\)\.toUpperCase\(\)/);
assert.match(formSrc, /COIN2: String\(ticker2\)\.toUpperCase\(\)/);
assert.match(formSrc, /COIN1_ACTION_INDEX: actionIndex1/);
assert.match(formSrc, /if \(result\?\.psbtHex && !txid\) \{[\s\S]+?<WatcherResultPanel/);
assert.match(formSrc, /Build unsigned PSBT/);
console.log('link-watcher-mode smoke OK');
