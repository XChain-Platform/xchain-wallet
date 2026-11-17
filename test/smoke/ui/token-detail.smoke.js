// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §27.6 / G071: Token detail page + clickable BalanceRow
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
//: no new host method required.
assert.ok(
    /messaging\.getHoldersForToken\b/.test(td),
    'TokenDetail uses messaging.getHoldersForToken for the holders panel',
);

// Native coins skip the holders panel since holders is a token concept.
assert.ok(
    /!isNative/.test(td),
    'TokenDetail gates the holders panel on the !isNative branch',
);

// Spec-named sections are present (labels were updated in the tabbed redesign).
// "Your balance" became the balance card: the held amount in the hero, over
// the coin or token's own caption.
assert.ok(
    /className=\{heroStyles\.amount\}[\s\S]{0,900}heroStyles\.amountValue/.test(td),
    'TokenDetail renders the balance card amount (was "Your balance")',
);
// "Metadata" is now the "Details" tab.
assert.ok(
    /id: 'details', label: tabLabel\(Icon\.InfoIcon, t\('tokenDetail\.tabs\.details'\)\)/.test(td),
    'TokenDetail renders the "Details" tab (was "Metadata")',
);
assert.ok(
    /'tokenDetail\.tabs\.details': 'Details'/.test(readFileSync(join(core, 'src', 'i18n', 'locales', 'en', 'tokenDetail.js'), 'utf8')),
    'the Details tab reads "Details"',
);
// "Actions" is now the first tab and holds the shared action list (G101).
assert.ok(
    /id: 'actions', label: tabLabel\(Icon\.ZapIcon, t\('tokenDetail\.tabs\.actions'\)\)/.test(td),
    'TokenDetail renders the "Actions" tab first (was "Actions")',
);
assert.ok(
    /<ActionList label=\{t\('tokenDetail\.actions\.label', \{ tick \}\)\}>/.test(td),
    'TokenDetail renders the action list for the token',
);
assert.ok(!/QuickActionTile/.test(td), 'TokenDetail draws no square action tiles (G101)');
// "Holders" section is still present via HoldersPanel component and tab id.
assert.ok(
    /HoldersPanel\b/.test(td),
    'TokenDetail renders the Holders section (HoldersPanel component)',
);

// --- 2. BalanceList: clickable rows + onSelectToken prop ------------------

const blSrc = readFileSync(join(components, 'BalanceList.jsx'), 'utf8');
assert.ok(/onSelectToken\b/.test(blSrc), 'BalanceList accepts onSelectToken');
assert.ok(/clickable/.test(blSrc), 'BalanceList row has clickable variant');
assert.ok(/<ListRow[\s\S]*?onClick=\{handleClick\}/.test(blSrc),
    'BalanceList delegates its primary action to ListRow');
assert.ok(/<button[\s\S]*?onTogglePin\(pinKey, !pinned\)/.test(blSrc)
    && /<button[\s\S]*?onToggleHide\(pinKey, !hidden\)/.test(blSrc),
    'BalanceList pin and hide actions use native buttons outside the primary action');

const blCss = readFileSync(join(components, 'BalanceList.module.css'), 'utf8');
assert.ok(/\.rowClickable\b/.test(blCss),
    'BalanceList CSS has the .rowClickable variant');

// (UnifiedBalanceList parity used to be section 3 here. Cluster I
//  FOLLOWUP 7 retired UnifiedBalanceList at v0.287.0: it had been
//  orphaned since the BalanceList consolidation, with no caller mounting
//  it in any shell. The previous parity assertions are gone.)

// --- 3. HomeTabs + Home thread onSelectToken downwards --------------------

const htSrc = readFileSync(join(components, 'HomeTabs.jsx'), 'utf8');
assert.ok(/onSelectToken\b/.test(htSrc),
    'HomeTabs accepts onSelectToken');
// The Balances list forwards through openBalanceRow, which restores the real
// (possibly null) fiat rate that the list's $0.00 display row replaced (U72).
// The lists take `openToken`: onSelectToken itself, except on wide Home
// (G115), where a row opens its detail in the panel beside the list.
assert.ok(/const openToken = wide \? selectAssetInPanel : onSelectToken;/.test(htSrc),
    'HomeTabs opens the token page through onSelectToken outside wide Home');
assert.ok(/fiatRate: source\.fiatRate \?\? null/.test(htSrc),
    'HomeTabs restores a Balances row\'s real rate before it opens');
// Home's two lists of assets (operator 2026-11-15): Balances (coins and
// tokens) and the NFTs grid.
const htOccurrences = (htSrc.match(/onSelectToken=\{(?:onSelectToken|openToken|openBalanceRow)\}/g) || []).length;
assert.ok(htOccurrences >= 2,
    'HomeTabs forwards onSelectToken into the Balances list and the NFTs grid (got ' + htOccurrences + ')');

const homeSrc = readFileSync(join(routes, 'Home.jsx'), 'utf8');
assert.ok(/onSelectToken\b/.test(homeSrc),
    'Home accepts onSelectToken');
assert.ok(/onSelectToken=\{onSelectToken\}/.test(homeSrc),
    'Home forwards onSelectToken into HomeTabs');

// --- 4. History gains initialSearchQuery prop ----------------------------

const histSrc = readFileSync(join(routes, 'History.jsx'), 'utf8');
assert.ok(/initialSearchQuery\b/.test(histSrc),
    'History accepts initialSearchQuery');
assert.ok(/rememberedView\?\.searchQuery\s*\?\?\s*initialSearchQuery/.test(histSrc),
    'History seeds searchQuery from the incoming query while allowing back-navigation restore');

// --- 5. Web + extension App.jsx wire the route ---------------------------

const webApp = readFileSync(join(web, 'src', 'App.jsx'), 'utf8');
assert.ok(/(from |const\s+TokenDetail\s*=\s*lazyRoute\(\s*\(\)\s*=>\s*import\()'@xchain-wallet\/core\/shared\/routes\/TokenDetail\.jsx'/.test(webApp),
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

// --- 6. Desktop App.jsx wires the route (parity) -------------------

const deskApp = readFileSync(join(wsRoot, 'packages', 'desktop', 'renderer', 'App.jsx'), 'utf8');
assert.ok(/from '@xchain-wallet\/core\/shared\/routes\/TokenDetail\.jsx'/.test(deskApp),
    'desktop App.jsx imports TokenDetail');
assert.ok(/'token-detail'/.test(deskApp),
    'desktop App.jsx adds the token-detail view literal');
assert.ok(/unlockedView === 'token-detail' && activeWalletId && tokenDetailRef/.test(deskApp),
    'desktop App.jsx renders the token-detail route');
assert.ok(/setTokenDetailRef\b/.test(deskApp),
    'desktop App.jsx tracks tokenDetailRef state');
assert.ok(/onSelectToken=/.test(deskApp),
    'desktop App.jsx wires onSelectToken into Home');
// One navigation history owns Back, so History opened from the token page
// returns to it without a per-route return slot.
// (The token page is one renderTokenDetail for Home, its wide panel and My
// Tokens, so the asset is the one that page was opened on.)
assert.ok(/onViewActivity=\{\(\) => \{\s*const scope = historyScopeForAsset\((?:tokenDetailRef|asset\(\))\);[\s\S]{0,300}?setUnlockedView\('history'\);/.test(deskApp),
    'desktop token-detail onViewActivity opens History scoped to the token');
assert.ok(/unlockedView === 'history' && activeWalletId[\s\S]{0,400}onBack=\{goBack\}/.test(deskApp),
    'desktop History goes Back through the navigation history, to token-detail');
assert.ok(!/setHistoryReturnTo\b/.test(deskApp),
    'desktop has no per-route History return slot');

console.log('token-detail smoke OK');
