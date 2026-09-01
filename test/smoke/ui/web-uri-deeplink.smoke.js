// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §47 / Cluster L FOLLOWUP 1 smoke: web `?uri=` deep-link routing.
//
// v0.191.0's `navigator.registerProtocolHandler('web+xchain', '/?uri=%s')`
// registers the SPA as the handler for `xchain:` URIs. This FOLLOWUP
// adds the consumer side: on mount the SPA reads `location.search`,
// runs the value through `parseXchainUri`, and routes to Send/Receive
// with the parsed intent prefilled.
//
// Asserts:
//   1. Send.jsx accepts a `prefill` prop and seeds initial form state
//      from it (address, amount, tick, chainId, memo).
//   2. Send's first-chain auto-select preserves a prefilled chainId.
//   3. Web App.jsx imports the core uri namespace, declares a
//      `sendPrefill` state slot, and runs a one-shot effect that reads
//      `?uri=` and routes to the matching view.
//   4. The effect strips the `uri` query param via
//      `history.replaceState` so a refresh doesn't re-trigger.
//   5. The Send route renders with `prefill={sendPrefill}` and clears
//      the prefill on back-navigation.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. Send accepts a prefill prop ------------------------------------

const sendSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx'),
    'utf8',
);
assert.ok(/export function Send\(\{ walletId, onBack, prefill = null\b/.test(sendSrc),
    'Send accepts a prefill prop (default null)');
for (const field of ['address', 'amount', 'tick', 'chainId', 'memo']) {
    assert.ok(
        new RegExp(`prefill\\?\\.${field}`).test(sendSrc),
        `Send seeds initial state from prefill.${field}`,
    );
}

// --- 2. First-chain auto-select preserves prefilled chainId ------------

assert.ok(
    /setChainId\(\(prev\)\s*=>\s*prev \|\| firstChain\)/.test(sendSrc),
    'Send.useEffect for getAddressesByChain preserves a prefilled chainId',
);

// --- 3. Web App.jsx wiring ---------------------------------------------

const webApp = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'App.jsx'),
    'utf8',
);
assert.ok(/import\s*\{\s*uri as coreUri\s*\}\s*from\s*'@xchain-wallet\/core'/.test(webApp),
    'web App imports the core uri namespace as coreUri');
assert.ok(/const \[sendPrefill, setSendPrefill\] = useState/.test(webApp),
    'web App declares a sendPrefill state slot');
assert.ok(
    /new URLSearchParams\(window\.location\.search\)[\s\S]*?\.get\('uri'\)/.test(webApp),
    'web App reads ?uri= from location.search',
);
assert.ok(/coreUri\.parseXchainUri\(raw,\s*\{\s*chainRegistry:\s*APP_CHAIN_REGISTRY\s*\}\)/.test(webApp),
    'web App passes the raw URI through coreUri.parseXchainUri WITH the chain registry (coin-code URIs need it to resolve chainId)');
assert.ok(
    /intent\.kind === 'send'[\s\S]*?setSendPrefill\([\s\S]*?setUnlockedView\('send'\)/.test(webApp),
    'web App routes kind:send → setSendPrefill + setUnlockedView(send)',
);
assert.ok(
    /intent\.kind === 'receive'[\s\S]*?setUnlockedView\('receive'\)/.test(webApp),
    'web App routes kind:receive → setUnlockedView(receive)',
);
assert.ok(
    /intent\.kind === 'execute' && intent\.contractActionIndex && intent\.chainId[\s\S]*?setContractRef\([\s\S]*?setExecutePrefill\([\s\S]*?setUnlockedView\('contract-execute'\)/.test(webApp),
    'web App routes kind:execute (guarded on contract index + chainId) → setContractRef + setExecutePrefill + contract-execute view',
);
assert.ok(/const \[executePrefill, setExecutePrefill\] = useState/.test(webApp),
    'web App declares an executePrefill state slot');
assert.ok(
    /initialMethod=\{executePrefill\?\.method\}[\s\S]*?initialParamsText=\{executePrefill\?\.paramsText\}/.test(webApp),
    'contract-execute route passes the executePrefill fields into ExecuteContractForm',
);
assert.ok(
    /setExecutePrefill\(null\);\s*setUnlockedView\('contract-detail'\)/.test(webApp),
    'contract-execute onBack clears the executePrefill',
);

// --- 4. URL clean-up via history.replaceState --------------------------

assert.ok(
    /params\.delete\('uri'\)[\s\S]*?window\.history\.replaceState\(null,\s*'',\s*url\)/.test(webApp),
    'web App strips the ?uri= param via history.replaceState after consumption',
);

// --- 5. Send route reads the prefill + clears on back ------------------

assert.ok(
    /<Send\b[\s\S]*?prefill=\{sendPrefill\}/.test(webApp),
    'Send route in App.jsx receives prefill={sendPrefill}',
);
assert.ok(
    /onBack=\{\(\)\s*=>\s*\{\s*\n\s*setSendPrefill\(null\);\s*\n\s*setUnlockedView\(sendBackTo\);/.test(webApp),
    'Send onBack clears the prefill so a fresh navigate to Send is clean',
);

console.log(
    "OK: web-uri-deeplink smoke (§47 Cluster L FOLLOWUP 1: Send.prefill prop seeds address/amount/tick/chainId/memo; first-chain auto-select preserves prefill; web App.jsx reads ?uri= → parseXchainUri → setSendPrefill + setUnlockedView; history.replaceState strips the param; back-navigation clears the prefill)",
);
