// §47 / Cluster L FOLLOWUP 5 smoke — describeXchainIntent localized labels.
//
// `describeXchainIntent(intent, { i18n })` renders a human-readable sentence
// for a parsed `xchain:` URI. Used by confirmation prompts and deep-link
// previews so the user sees "Send 0.5 BTC to bc1q…7qz3" instead of a raw
// JSON intent.
//
// Asserts:
//   1. Send variants pick the right template based on which fields are set
//      (amount+asset+address, amount+asset, asset+address, asset, address,
//      bare).
//   2. Receive variants do the same, keyed on intent.kind === 'receive'.
//   3. Unknown / null intent returns the unknown-link label.
//   4. Address gets middle-truncated (head 6 / tail 4) in the output.
//   5. Locale switch picks up translated strings.
//   6. Throws when deps.i18n.t is missing.
//   7. Helper is exported from the core uri namespace.
//   8. Round-trips through parseXchainUri → describeXchainIntent.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    parseXchainUri,
    describeXchainIntent,
} from '../../../packages/core/src/uri/index.js';
import {
    registerLocale,
    setLocale,
    t,
} from '../../../packages/core/src/i18n/index.js';
import * as coreUri from '../../../packages/core/src/uri/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const i18n = { t };

// --- 1. Send variants ----------------------------------------------------

assert.equal(
    describeXchainIntent({ kind: 'send' }, { i18n }),
    'Send',
);
assert.equal(
    describeXchainIntent(
        { kind: 'send', address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' },
        { i18n },
    ),
    'Send to bc1qxy…0wlh',
);
assert.equal(
    describeXchainIntent({ kind: 'send', asset: 'XCP' }, { i18n }),
    'Send XCP',
);
assert.equal(
    describeXchainIntent(
        { kind: 'send', asset: 'XCP', address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' },
        { i18n },
    ),
    'Send XCP to bc1qxy…0wlh',
);
assert.equal(
    describeXchainIntent({ kind: 'send', amount: '0.5', asset: 'BTC' }, { i18n }),
    'Send 0.5 BTC',
);
assert.equal(
    describeXchainIntent(
        {
            kind: 'send',
            amount: '0.5',
            asset: 'BTC',
            address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        },
        { i18n },
    ),
    'Send 0.5 BTC to bc1qxy…0wlh',
);

// --- 2. Receive variants ------------------------------------------------

assert.equal(
    describeXchainIntent({ kind: 'receive' }, { i18n }),
    'Receive',
);
assert.equal(
    describeXchainIntent(
        { kind: 'receive', address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' },
        { i18n },
    ),
    'Receive at bc1qxy…0wlh',
);
assert.equal(
    describeXchainIntent({ kind: 'receive', asset: 'XCP' }, { i18n }),
    'Receive XCP',
);
assert.equal(
    describeXchainIntent(
        { kind: 'receive', asset: 'XCP', address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' },
        { i18n },
    ),
    'Receive XCP at bc1qxy…0wlh',
);
assert.equal(
    describeXchainIntent({ kind: 'receive', amount: '100', asset: 'XCP' }, { i18n }),
    'Receive 100 XCP',
);
assert.equal(
    describeXchainIntent(
        {
            kind: 'receive',
            amount: '100',
            asset: 'XCP',
            address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        },
        { i18n },
    ),
    'Receive 100 XCP at bc1qxy…0wlh',
);

// --- 3. Unknown / null intent -------------------------------------------

assert.equal(describeXchainIntent({ kind: 'unknown' }, { i18n }), 'Unrecognized link');
assert.equal(describeXchainIntent(null, { i18n }), 'Unrecognized link');
assert.equal(describeXchainIntent(undefined, { i18n }), 'Unrecognized link');

// --- 4. Short addresses are passed through verbatim --------------------

// Anything <= 14 chars stays whole (truncating "bc1qabc" to "bc1qab…abc"
// would be silly).
assert.equal(
    describeXchainIntent({ kind: 'send', address: 'short' }, { i18n }),
    'Send to short',
);
assert.equal(
    describeXchainIntent({ kind: 'send', address: '14characteraddr' }, { i18n }),
    // 15 chars — gets truncated
    'Send to 14char…addr',
);

// --- 5. Locale switch picks up translated copy --------------------------

registerLocale('xx', {
    'uri.intent.sendAmountTo': 'Yolla {amount} {asset} → {address}',
});
setLocale('xx');
assert.equal(
    describeXchainIntent(
        {
            kind: 'send',
            amount: '0.5',
            asset: 'BTC',
            address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        },
        { i18n },
    ),
    'Yolla 0.5 BTC → bc1qxy…0wlh',
);
// Missing key in xx falls back to en.
assert.equal(
    describeXchainIntent({ kind: 'send' }, { i18n }),
    'Send',
);
setLocale('en');

// --- 6. Throws when deps.i18n.t is missing ------------------------------

assert.throws(
    () => describeXchainIntent({ kind: 'send' }, {}),
    /describeXchainIntent: deps\.i18n\.t is required/,
);
assert.throws(
    () => describeXchainIntent({ kind: 'send' }, { i18n: {} }),
    /describeXchainIntent: deps\.i18n\.t is required/,
);

// --- 7. Helper is exported from the core uri namespace ------------------

assert.equal(typeof coreUri.describeXchainIntent, 'function');
const uriIdx = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'uri', 'index.js'),
    'utf8',
);
assert.ok(
    /describeXchainIntent/.test(uriIdx),
    'core uri index re-exports describeXchainIntent',
);

// --- 8. Round-trip through parseXchainUri -------------------------------

const sendUri = 'xchain://bitcoin-mainnet/BTC?amount=0.5&to=bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
assert.equal(
    describeXchainIntent(parseXchainUri(sendUri), { i18n }),
    'Send 0.5 BTC to bc1qxy…0wlh',
);

// BIP21 amount without asset (asset resolved from chain registry by the
// caller, not here) degrades to the sendTo template — the caller's
// confirmation surface still shows the raw amount field separately.
const bip21Uri = 'xchain:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=0.5';
assert.equal(
    describeXchainIntent(parseXchainUri(bip21Uri), { i18n }),
    'Send to bc1qxy…0wlh',
);

const garbage = 'not-an-xchain-uri';
assert.equal(
    describeXchainIntent(parseXchainUri(garbage), { i18n }),
    'Unrecognized link',
);

// --- 9. i18n dictionary exposes every key -------------------------------

const en = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'i18n', 'locales', 'en', 'index.js'),
    'utf8',
);
const requiredKeys = [
    'uri.intent.send',
    'uri.intent.sendTo',
    'uri.intent.sendAsset',
    'uri.intent.sendAssetTo',
    'uri.intent.sendAmount',
    'uri.intent.sendAmountTo',
    'uri.intent.receive',
    'uri.intent.receiveAt',
    'uri.intent.receiveAsset',
    'uri.intent.receiveAssetAt',
    'uri.intent.receiveAmount',
    'uri.intent.receiveAmountAt',
    'uri.intent.unknown',
];
for (const key of requiredKeys) {
    assert.ok(
        en.includes(`'${key}'`),
        `en dictionary defines "${key}"`,
    );
}

console.log(
    "OK — xchain-uri-describe smoke (Cluster L FOLLOWUP 5 — describeXchainIntent renders 13 send/receive variants based on intent fields; address middle-truncated head6/tail4 over 14 chars; locale switch picks up translated copy with en fallback; deps.i18n.t required; round-trips through parseXchainUri for path-style + BIP21 + garbage)",
);
