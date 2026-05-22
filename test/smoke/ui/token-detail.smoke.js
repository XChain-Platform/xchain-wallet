// Smoke for §27.6 / G071 — Token detail page + clickable BalanceRow
// integration + web/extension App.jsx wiring + History initialSearchQuery.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const components = join(core, 'src', 'shared', 'components');
const routes = join(core, 'src', 'shared', 'routes');

// --- 1. TokenDetail.jsx exists + exports the component --------------------

const tdPath = join(routes, 'TokenDetail.jsx');
const tdCss = join(routes, 'TokenDetail.module.css');
assert.ok(existsSync(tdPath), 'TokenDetail.jsx exists');
assert.ok(existsSync(tdCss), 'TokenDetail.module.css exists');

const td = readFileSync(tdPath, 'utf8');
assert.ok(/export function TokenDetail\b/.test(td), 'TokenDetail is a named export');
for (const prop of ['walletId', 'chainId', 'tick', 'kind', 'displayName', 'divisibility', 'fiatRate', 'quantity', 'onBack', 'onSend', 'onReceive', 'onViewActivity']) {
    assert.ok(
        new RegExp(`\\b${prop}\\b`).test(td),
        `TokenDetail accepts ${prop} prop`,
    );
}

// Holders panel uses the existing messaging.getHoldersForToken endpoint
// — no new host method required.
assert.ok(
    /messaging\.getHoldersForToken\b/.test(td),
    'TokenDetail uses messaging.getHoldersForToken for the holders panel',
);

// Native coins skip the holders panel since holders is a token concept.
assert.ok(
    /!isNative/.test(td),
    'TokenDetail gates the holders panel on the !isNative branch',
);

// Spec-named sections are present.
for (const label of ['Your balance', 'Metadata', 'Actions', 'Holders']) {
    assert.ok(
        new RegExp(`>${label}<|"${label}"`).test(td),
        `TokenDetail renders the "${label}" section`,
    );
}

// --- 2. BalanceList: clickable rows + onSelectToken prop ------------------

const blSrc = readFileSync(join(components, 'BalanceList.jsx'), 'utf8');
assert.ok(/onSelectToken\b/.test(blSrc), 'BalanceList accepts onSelectToken');
assert.ok(/clickable/.test(blSrc), 'BalanceList row has clickable variant');
assert.ok(/Tag\s*=\s*clickable\s*\?\s*'button'/.test(blSrc),
    'BalanceList row tag becomes <button> when clickable');

const blCss = readFileSync(join(components, 'BalanceList.module.css'), 'utf8');
assert.ok(/\.rowClickable\b/.test(blCss),
    'BalanceList CSS has the .rowClickable variant');

// (UnifiedBalanceList parity used to be section 3 here. Cluster I
//  FOLLOWUP 7 retired UnifiedBalanceList at v0.287.0 — it had been
//  orphaned since the BalanceList consolidation, with no caller mounting
//  it in any shell. The previous parity assertions are gone.)

// --- 3. HomeTabs + Home thread onSelectToken downwards --------------------

const htSrc = readFileSync(join(components, 'HomeTabs.jsx'), 'utf8');
assert.ok(/onSelectToken\b/.test(htSrc),
    'HomeTabs accepts onSelectToken');
const htOccurrences = (htSrc.match(/onSelectToken=\{onSelectToken\}/g) || []).length;
assert.ok(htOccurrences >= 3,
    'HomeTabs forwards onSelectToken into all three balance tabs (got ' + htOccurrences + ')');

const homeSrc = readFileSync(join(routes, 'Home.jsx'), 'utf8');
assert.ok(/onSelectToken\b/.test(homeSrc),
    'Home accepts onSelectToken');
assert.ok(/onSelectToken=\{onSelectToken\}/.test(homeSrc),
    'Home forwards onSelectToken into HomeTabs');

// --- 4. History gains initialSearchQuery prop ----------------------------

const histSrc = readFileSync(join(routes, 'History.jsx'), 'utf8');
assert.ok(/initialSearchQuery\b/.test(histSrc),
    'History accepts initialSearchQuery');
assert.ok(/useState\(initialSearchQuery/.test(histSrc),
    'History seeds searchQuery state from initialSearchQuery');

// --- 5. Web + extension App.jsx wire the route ---------------------------

const webApp = readFileSync(join(web, 'src', 'App.jsx'), 'utf8');
assert.ok(/from '@xchain-wallet\/core\/shared\/routes\/TokenDetail\.jsx'/.test(webApp),
    'web App.jsx imports TokenDetail');
assert.ok(/'token-detail'/.test(webApp),
    'web App.jsx adds the token-detail view literal');
assert.ok(/setTokenDetailRef\b/.test(webApp),
    'web App.jsx tracks tokenDetailRef state');
assert.ok(/historyInitialQuery\b/.test(webApp),
    'web App.jsx tracks historyInitialQuery state');
assert.ok(/onSelectToken=/.test(webApp),
    'web App.jsx wires onSelectToken into Home');

const extApp = readFileSync(join(ext, 'src', 'popup', 'App.jsx'), 'utf8');
assert.ok(/from '@xchain-wallet\/core\/shared\/routes\/TokenDetail\.jsx'/.test(extApp),
    'extension App.jsx imports TokenDetail');
assert.ok(/'token-detail'/.test(extApp),
    'extension App.jsx adds the token-detail view literal');
assert.ok(/setTokenDetailRef\b/.test(extApp),
    'extension App.jsx tracks tokenDetailRef state');
assert.ok(/onSelectToken=/.test(extApp),
    'extension App.jsx wires onSelectToken into Home');

console.log('token-detail smoke OK');
