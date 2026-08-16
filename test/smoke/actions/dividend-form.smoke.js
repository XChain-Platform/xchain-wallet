// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 2, Step 23 (piece 8): DIVIDEND authoring form
// (§40.8).
//
// Asserts:
//   1. DividendForm.jsx exists + exports a single component.
//   2. Three-stage state machine (form → review/submitting → done).
//   3. Review runs composed DIVIDEND params through decoder.decodeAction
//      with action: "DIVIDEND".
//   4. Sign wires through messaging.dividendAction.
//   5. Holder-count preview fetches via messaging.getHoldersForToken
//      when TICK settles (debounced); the preview excludes the source
//      address per DIVIDEND.md.
//   6. Validation: required fields, ticker-regex, positive amount,
//      memo pipe/semicolon rejection.
//   7. Params composer pins VERSION='0', uppercases tickers, only
//      sets MEMO when non-empty.
//   8. Core flow dividendAction + holdersFor are re-exported from
//      @xchain-wallet/core and guard required inputs. holdersFor calls
//      sdk.getHolders(tick, opts).
//   9. Decoder DIVIDEND case surfaces summary + details + empty-TICK /
//      empty-DIVIDEND_TICK / non-positive-amount / pipe-memo warnings.
//  10. Background host registers action.dividend + holders.forTick;
//      all three shell messaging files export dividendAction +
//      getHoldersForToken.
//  11. ActionsMenu + App.jsx track the 'dividend' sub-route in popup +
//      web + desktop.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows, decoder } from '../../../packages/core/src/index.js';
import { surfacesEntry } from '../_action-entries.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const formPath = join(sharedRoutes, 'DividendForm.jsx');
assert.ok(existsSync(formPath), 'DividendForm.jsx exists');

const src = readFileSync(formPath, 'utf8');

// --- 1. Single-component export ---------------------------------------

assert.ok(/export function DividendForm\b/.test(src), 'DividendForm is a named export');
assert.equal(
    (src.match(/^export\s+(function|const|class)\b/gm) || []).length,
    1,
    'DividendForm.jsx only exports the component',
);
assert.ok(
    /IssueTokenForm\.module\.css/.test(src),
    'DividendForm reuses IssueTokenForm CSS module',
);

// --- 2. Three-stage state machine -------------------------------------

for (const stage of ['form', 'review', 'submitting', 'done']) {
    assert.ok(src.includes(`'${stage}'`), `DividendForm tracks stage "${stage}"`);
}

// --- 3. Review runs through decoder.decodeAction ----------------------

assert.ok(
    /action:\s*['"]DIVIDEND['"]/.test(src),
    'DividendForm calls decoder with action: "DIVIDEND"',
);
assert.ok(/decoderLib\.decodeAction/.test(src), 'DividendForm invokes decoder.decodeAction');
assert.ok(src.includes('decoded.warnings'), 'DividendForm renders decoder warnings');

// --- 4. Sign wires through messaging.dividendAction -------------------

assert.ok(
    /messaging\.dividendAction\s*\(/.test(src),
    'DividendForm calls messaging.dividendAction',
);
assert.ok(src.includes("'InvalidPasswordError'"), 'DividendForm handles wrong-password');

// --- 5. Holder-count preview ------------------------------------------

assert.ok(
    /messaging\.getHoldersForToken/.test(src),
    'DividendForm fetches holders via messaging.getHoldersForToken',
);
assert.ok(
    /setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*getHoldersForToken/.test(src),
    'DividendForm debounces the holders fetch',
);
assert.ok(
    /source address is excluded|sourceExcluded|source excluded/.test(src),
    'DividendForm preview excludes the source address per DIVIDEND.md',
);
assert.ok(
    /Eligible holders/.test(src),
    'DividendForm surfaces eligible-holder count on review',
);
assert.ok(
    /Total distribution/.test(src),
    'DividendForm surfaces total-distribution estimate on review',
);

// --- 6. Validation ----------------------------------------------------

assert.ok(/Holder-of token is required/.test(src), 'validation: empty TICK');
assert.ok(/Dividend ticker is required/.test(src), 'validation: empty DIVIDEND_TICK');
assert.ok(
    /Per-unit amount must be a positive number/.test(src),
    'validation: zero amount',
);
assert.ok(
    /accepts A–Z, 0–9, period, or \^TICK_ID/.test(src),
    'validation: ticker regex',
);
assert.ok(
    /Memo cannot contain \| or ;/.test(src),
    'validation: memo pipe/semicolon',
);

// --- 7. Params composer -----------------------------------------------

assert.ok(/VERSION:\s*['"]0['"]/.test(src), 'DividendForm pins VERSION=0');
assert.ok(/\.toUpperCase\(\)/.test(src), 'DividendForm uppercases tickers');
assert.ok(
    /if \(memo\.trim\(\)\) p\.MEMO\s*=/.test(src),
    'DividendForm only sets MEMO when non-empty',
);

// --- 8. Core flow + holders query -------------------------------------

assert.equal(
    typeof flows.dividendAction,
    'function',
    'flows.dividendAction re-exported from core',
);
assert.equal(
    typeof flows.holdersFor,
    'function',
    'flows.holdersFor re-exported from core',
);

await assert.rejects(
    async () => flows.dividendAction(),
    /dividendAction: opts is required/,
);
await assert.rejects(
    async () => flows.dividendAction({ params: {} }),
    /params\.TICK is required/,
);
await assert.rejects(
    async () => flows.dividendAction({ params: { TICK: 'A' } }),
    /params\.DIVIDEND_TICK is required/,
);
await assert.rejects(
    async () => flows.dividendAction({ params: { TICK: 'A', DIVIDEND_TICK: 'B' } }),
    /params\.AMOUNT is required/,
);
await assert.rejects(
    async () => flows.dividendAction({
        params: { TICK: 'A', DIVIDEND_TICK: 'B', AMOUNT: '1' },
    }),
    /dividendAction: from is required/,
);

await assert.rejects(
    async () => flows.holdersFor({ chainId: 'bitcoin-mainnet', tick: 'X' }),
    /holdersFor: sdkRegistry is required/,
);
await assert.rejects(
    async () => flows.holdersFor({ sdkRegistry: {}, tick: 'X' }),
    /holdersFor: chainId is required/,
);
await assert.rejects(
    async () => flows.holdersFor({ sdkRegistry: {}, chainId: 'bitcoin-mainnet' }),
    /holdersFor: tick is required/,
);

{
    let called = null;
    const fakeSdk = {
        getHolders: (...args) => { called = args; return { data: [] }; },
    };
    const sdkRegistry = { get: () => fakeSdk };
    await flows.holdersFor({
        sdkRegistry, chainId: 'bitcoin-mainnet', tick: 'MYTOKEN', opts: { limit: 100 },
    });
    assert.deepEqual(called, ['MYTOKEN', { limit: 100 }]);
}

const flowSrc = readFileSync(join(core, 'src', 'flows', 'dividendAction.js'), 'utf8');
assert.ok(
    /action:\s*'DIVIDEND'/.test(flowSrc),
    'dividendAction flow forwards action: "DIVIDEND" to submitAction',
);
assert.ok(
    /normalizeSource/.test(flowSrc),
    'dividendAction flow reuses normalizeSource from sendToken',
);

// --- 9. Decoder coverage ----------------------------------------------

{
    const d = decoder.decodeAction({
        action: 'DIVIDEND',
        params: { VERSION: '0', TICK: 'MYTOKEN', DIVIDEND_TICK: 'XCP', AMOUNT: '0.5' },
        chainId: 'bitcoin-mainnet',
    });
    assert.ok(
        /Pay 0\.5 XCP per unit of MYTOKEN/.test(d.summary),
        'decoder summary matches §40.8 wording',
    );
    assert.ok(
        d.details.some((x) => x.label === 'Holders of' && x.value === 'MYTOKEN'),
        'decoder surfaces Holders-of row',
    );
    assert.ok(
        d.details.some((x) => x.label === 'Receive' && x.value === 'XCP'),
        'decoder surfaces Receive row',
    );

    const empty = decoder.decodeAction({
        action: 'DIVIDEND',
        params: { VERSION: '0' },
    });
    assert.ok(
        empty.warnings.some((w) => /Holder ticker is empty/.test(w)),
        'decoder warns on empty TICK',
    );
    assert.ok(
        empty.warnings.some((w) => /Dividend ticker is empty/.test(w)),
        'decoder warns on empty DIVIDEND_TICK',
    );
    assert.ok(
        empty.warnings.some((w) => /Per-unit amount is not positive/.test(w)),
        'decoder warns on zero amount',
    );

    const bad = decoder.decodeAction({
        action: 'DIVIDEND',
        params: {
            VERSION: '0', TICK: 'X', DIVIDEND_TICK: 'Y', AMOUNT: '1',
            MEMO: 'bad|memo',
        },
    });
    assert.ok(
        bad.warnings.some((w) => /\| or ;/.test(w)),
        'decoder flags pipe/semicolon in MEMO',
    );
}

// --- 10. Background handler + messaging helpers ----------------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
assert.ok(/host\.register\('action\.dividend'/.test(bg), 'registers action.dividend');
assert.ok(/host\.register\('holders\.forTick'/.test(bg), 'registers holders.forTick');

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(
        /export function dividendAction\b/.test(m),
        `${shell} messaging.js exports dividendAction`,
    );
    assert.ok(
        /sendMessage\('action\.dividend'/.test(m),
        `${shell} messaging routes dividendAction via action.dividend`,
    );
    assert.ok(
        /export function getHoldersForToken\b/.test(m),
        `${shell} messaging.js exports getHoldersForToken`,
    );
    assert.ok(
        /sendMessage\('holders\.forTick'/.test(m),
        `${shell} messaging routes getHoldersForToken via holders.forTick`,
    );
}

// --- 11. ActionsMenu + App.jsx sub-routes ----------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('DividendForm'), `${shell} App.jsx imports DividendForm`);
    assert.ok(
        app.includes("'dividend'"),
        `${shell} App.jsx tracks the dividend sub-route`,
    );
    assert.ok(
        surfacesEntry(app, 'dividend', 'Pay dividend'),
        `${shell} App.jsx registers the Pay dividend entry`,
    );
    assert.ok(
        /onPayDividend:\s*\(\)\s*=>\s*setUnlockedView\('dividend'\)/.test(app),
        `${shell} App.jsx wires onPayDividend to the dividend sub-route`,
    );
}

console.log(
    'OK: dividend form smoke (DividendForm §40.8 + dividendAction core flow + action.dividend handler + holdersFor explorer passthrough + three-shell messaging helpers + ActionsMenu Pay dividend entry + popup/web/desktop wiring + decoder DIVIDEND case + holder-count preview with source-address exclusion)',
);
