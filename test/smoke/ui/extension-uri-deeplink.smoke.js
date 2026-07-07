// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §47 / Cluster L FOLLOWUP 2 smoke: extension popup deep-link
// handling for shared `xchain:` links via the manifest's
// `protocol_handlers` block.
//
// v0.191.0 wired the web shell's `navigator.registerProtocolHandler`;
// v0.193.0's Cluster L FOLLOWUP 1 added consumer-side `?uri=` parsing
// in the web App.jsx. This FOLLOWUP mirrors that wiring in the
// extension popup so a `web+xchain:` click anywhere in the browser
// can land directly inside the popup with the Send route prefilled.
//
// Asserts:
//   1. extension manifest declares `protocol_handlers` claiming
//      `web+xchain` → `popup.html?uri=%s`.
//   2. popup App.jsx imports `uri` from @xchain-wallet/core and
//      declares a `sendPrefill` state slot.
//   3. popup App.jsx runs a one-shot effect that reads `?uri=` from
//      location.search and calls coreUri.parseXchainUri.
//   4. The effect routes kind:send → setSendPrefill +
//      setUnlockedView('send'), and kind:receive → setUnlockedView('receive').
//   5. The effect strips `?uri=` via history.replaceState so a refresh
//      doesn't re-trigger.
//   6. The Send route renders with `prefill={sendPrefill}`.
//   7. Send onBack clears the prefill before navigating Home.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. Manifest declares protocol_handlers --------------------------

const manifest = JSON.parse(readFileSync(
    join(wsRoot, 'packages', 'extension', 'manifest.json'),
    'utf8',
));
assert.ok(Array.isArray(manifest.protocol_handlers),
    'protocol_handlers is an array');
assert.equal(manifest.protocol_handlers.length, 1);
const handler = manifest.protocol_handlers[0];
assert.equal(handler.protocol, 'web+xchain');
assert.match(handler.uriTemplate, /popup\.html\?uri=%s/);
assert.ok(typeof handler.name === 'string' && handler.name.length > 0,
    'protocol_handlers[0].name is non-empty');

// --- 2. popup imports core uri + sendPrefill state -----------------

const popup = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'popup', 'App.jsx'),
    'utf8',
);
assert.ok(/import\s*\{\s*uri as coreUri\s*\}\s*from\s*'@xchain-wallet\/core'/.test(popup),
    'popup imports the core uri namespace as coreUri');
assert.ok(/const \[sendPrefill, setSendPrefill\] = useState/.test(popup),
    'popup declares sendPrefill state slot');

// --- 3. ?uri= read + parser called ---------------------------------

assert.ok(
    /new URLSearchParams\(window\.location\.search\)[\s\S]*?\.get\('uri'\)/.test(popup),
    'popup reads ?uri= from location.search',
);
assert.ok(/coreUri\.parseXchainUri\(raw,\s*\{\s*chainRegistry:\s*APP_CHAIN_REGISTRY\s*\}\)/.test(popup),
    'popup runs the raw URI through coreUri.parseXchainUri WITH the chain registry (coin-code URIs need it to resolve chainId)');

// --- 4. Send/receive/execute routing --------------------------------

assert.ok(
    /intent\.kind === 'send'[\s\S]*?setSendPrefill\([\s\S]*?setUnlockedView\('send'\)/.test(popup),
    'popup routes kind:send → setSendPrefill + setUnlockedView(send)',
);
assert.ok(
    /intent\.kind === 'receive'[\s\S]*?setUnlockedView\('receive'\)/.test(popup),
    'popup routes kind:receive → setUnlockedView(receive)',
);
assert.ok(
    /intent\.kind === 'execute' && intent\.contractActionIndex && intent\.chainId[\s\S]*?setContractRef\([\s\S]*?setExecutePrefill\([\s\S]*?setUnlockedView\('contract-execute'\)/.test(popup),
    'popup routes kind:execute (guarded on contract index + chainId) → setContractRef + setExecutePrefill + contract-execute view',
);
assert.ok(/const \[executePrefill, setExecutePrefill\] = useState/.test(popup),
    'popup declares an executePrefill state slot');
assert.ok(
    /initialMethod=\{executePrefill\?\.method\}[\s\S]*?initialParamsText=\{executePrefill\?\.paramsText\}[\s\S]*?initialGasLimit=\{executePrefill\?\.gasLimit\}/.test(popup),
    'popup contract-execute route passes the executePrefill fields into ExecuteContractForm',
);

// --- 5. URL clean-up via history.replaceState ----------------------

assert.ok(
    /params\.delete\('uri'\)[\s\S]*?window\.history\.replaceState\(null,\s*'',\s*url\)/.test(popup),
    'popup strips ?uri= via history.replaceState after consumption',
);

// --- 6. Send renders with prefill={sendPrefill} --------------------

assert.ok(
    /<Send\b[\s\S]*?prefill=\{sendPrefill\}/.test(popup),
    'Send route in popup App.jsx receives prefill={sendPrefill}',
);

// --- 7. Send onBack clears the prefill -----------------------------

assert.ok(
    /onBack=\{\(\)\s*=>\s*\{\s*\n\s*setSendPrefill\(null\);\s*\n\s*setUnlockedView\(sendBackTo\);/.test(popup),
    'Send onBack clears sendPrefill before navigating its return target',
);

console.log(
    "OK: extension-uri-deeplink smoke (Cluster L FOLLOWUP 2: extension manifest declares protocol_handlers for web+xchain → popup.html?uri=%s; popup App.jsx imports core uri ns, declares sendPrefill state, parses ?uri= once on mount, routes send/receive, strips param via history.replaceState; Send renders with prefill={sendPrefill}, onBack clears it)",
);
