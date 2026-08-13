// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for : the store-listing capture must be REPRODUCIBLE.
//
// verify-listing-assets.mjs tells a STALE operator to "rebuild the shell at
// the ref you are submitting and re-run the capture, which re-pins as it
// goes". Driven on 2026-08-08 against the Chrome set, that produced three
// images whose bytes ALL differed from the pinned ones while the product had
// not moved: the only moving pixels were the price-change figure, the
// sparkline and the demo address. So way out (1) always succeeded, could
// never tell a product change from a dice roll, and re-rolled the numbers the
// public listing advertises every time it was taken.
//
// Three inputs made it non-deterministic, and this file guards all three,
// because each of them is a one-line edit away from coming back:
//
//   1. the demo wallet's MNEMONIC (fresh per run -> a different address in
//      the image). Frozen only under capture mode;
//   2. the demo CLOCK. Every fixture that dates a row has to be injectable,
//      and two of them were not;
//   3. the demo wallet's ID, a per-session UUID that seeds the portfolio
//      chart's synthesized walk -> a different sparkline and a different
//      price-change figure. Frozen for every demo wallet;
//   4. the LIVE price quote behind the hero's 24h change line, found by
//      running two captures after fixing 1-3: whether the fetch landed
//      before the screenshot decided whether that line existed, and the
//      whole card below it sat a line lower when it did. Demo wallets
//      now price themselves from their own fixtures.
//
// This is a source + behaviour audit, not a capture: driving the real capture
// needs a built extension, a headed browser and about a minute, which is not
// what a smoke is for. What it can do is fail the moment the freeze is
// removed.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DEMO_CAPTURE_FLAG_KEY,
    DEMO_CAPTURE_MNEMONIC,
    DEMO_CAPTURE_CLOCK_MS,
    DEMO_CHART_SEED,
    isDemoCaptureMode,
    demoCaptureMnemonic,
} from '../../../packages/core/src/flows/demoCapture.js';
import {
    synthesizeDemoDefiPositions,
    synthesizeDemoDispenses,
    synthesizeDemoNativePrices,
} from '../../../packages/core/src/flows/demoFixtures.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...parts) => readFileSync(join(wsRoot, ...parts), 'utf8');

// ─── 1. capture mode is OFF for everyone but the harness ───────────────

// Smokes run in plain Node, which has no localStorage, and that is the
// state a shell without one is in too: it must read as "not capturing"
// rather than throw on the demo lane's happy path.
assert.equal(typeof globalThis.localStorage, 'undefined',
    'this smoke assumes a bare Node global; if a shim appears, the no-storage '
    + 'case below stops being tested');
assert.equal(isDemoCaptureMode(), false,
    'a shell with no localStorage must read as NOT capturing');
assert.equal(demoCaptureMnemonic(), null,
    'with capture mode off the demo lane generates its own mnemonic, which is what '
    + 'every real user must keep getting');

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};
try {
    assert.equal(isDemoCaptureMode(), false, 'an unarmed localStorage is not capture mode');
    assert.equal(demoCaptureMnemonic(), null, 'an unarmed localStorage hands out no mnemonic');

    store.set(DEMO_CAPTURE_FLAG_KEY, '1');
    assert.equal(isDemoCaptureMode(), true, 'the armed flag turns capture mode on');
    assert.equal(demoCaptureMnemonic(), DEMO_CAPTURE_MNEMONIC,
        'an armed capture takes the committed demo-only phrase, so the address printed in '
        + 'the store screenshots is the same address on every capture');
} finally {
    delete globalThis.localStorage;
}

// The frozen phrase is the published BIP39 all-zero test vector. A phrase
// that merely LOOKED random would be indistinguishable from a leaked seed
// to anyone scanning this tree, which is the exact objection that made
// this a decision rather than a build.
assert.equal(DEMO_CAPTURE_MNEMONIC, `${'abandon '.repeat(11)}about`,
    'the demo-only mnemonic must stay the published test vector; nothing else reads as '
    + 'unmistakably demo-only');

// ─── 2. every demo fixture that dates a row is clock-injectable ────────

// Comments stripped first: this file's own header explains the rule by
// quoting `Date.now()`, and a prose mention is not a clock read. Counting
// them would fail the audit for documenting itself.
const fixturesSrc = read('packages', 'core', 'src', 'flows', 'demoFixtures.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const clockReads = fixturesSrc.match(/Date\.now\(\)/g) || [];
const guardedReads = fixturesSrc.match(/typeof opts\.now === 'number' \? opts\.now : Date\.now\(\)/g)
    || [];
assert.ok(clockReads.length > 0, 'demoFixtures still dates rows against a clock');
assert.equal(guardedReads.length, clockReads.length,
    `demoFixtures.js has ${clockReads.length} Date.now() reads but only ${guardedReads.length} `
    + 'of them sit behind an `opts.now` guard. An unguarded one is a fixture nobody can '
    + 'freeze, and it moves pixels in a permanent public store image on every capture.');

const NOW = DEMO_CAPTURE_CLOCK_MS;
const LATER = NOW + 3 * 60 * 60 * 1000;
assert.deepEqual(
    synthesizeDemoDefiPositions({ now: NOW }),
    synthesizeDemoDefiPositions({ now: NOW }),
    'the DeFi feed must repeat exactly at one instant',
);
assert.notDeepEqual(
    synthesizeDemoDefiPositions({ now: LATER }),
    synthesizeDemoDefiPositions({ now: NOW }),
    'the DeFi feed must actually READ opts.now; accepting it and ignoring it would pass '
    + 'the equality check above while the capture kept moving',
);
const dispenses = synthesizeDemoDispenses('4200981', { now: NOW });
assert.ok(dispenses.length > 0, 'this dispenser fixture has fills, so the clock is exercised');
assert.deepEqual(dispenses, synthesizeDemoDispenses('4200981', { now: NOW }),
    'the dispense list must repeat exactly at one instant');
assert.notDeepEqual(dispenses, synthesizeDemoDispenses('4200981', { now: LATER }),
    'the dispense list must actually READ opts.now');

// ─── 3. the demo chart no longer seeds on a per-session UUID ───────────

const chartSrc = read('packages', 'core', 'src', 'shared', 'components', 'PortfolioChart.jsx');
assert.match(chartSrc, /const isDemo = isDemoWallet\(walletId\);/,
    'PortfolioChart must know whether it is drawing a demo wallet');
assert.match(chartSrc, /const seedId = isDemo \? DEMO_CHART_SEED : walletId;/,
    'PortfolioChart must seed demo wallets on DEMO_CHART_SEED. Seeded on the wallet id it '
    + 'draws a different sparkline (and prints a different price-change figure) every demo '
    + 'session, which was two of the moving bands between two captures.');
assert.ok(!/\$\{walletId \|\| '_'\}/.test(chartSrc),
    'the synthesized walk must be keyed on the seed, not on the raw wallet id');
assert.ok(DEMO_CHART_SEED.length > 0, 'the demo chart seed is a real constant');

// ─── 3b. a demo wallet prices itself, so no live quote moves the card ──

// The last mover found by actually running two captures: the hero's 24h
// change line comes from the live price oracle, and whether that fetch
// landed before the screenshot decided whether the line rendered at all -
// which shifted every row below it by the height of one line.
const demoPrices = synthesizeDemoNativePrices(['bitcoin-mainnet', 'litecoin-mainnet', 'bitcoin-testnet']);
assert.equal(typeof demoPrices['bitcoin-mainnet'].change24hPct, 'number',
    'the demo wallet needs its own 24h figure, or the hero has nothing to render');
assert.deepEqual(demoPrices, synthesizeDemoNativePrices(['bitcoin-mainnet', 'litecoin-mainnet', 'bitcoin-testnet']),
    'demo prices must be a fixture, not a quote');
assert.equal(demoPrices['bitcoin-testnet'], null,
    'a chain the demo fixtures do not price must stay unpriced rather than invent a number');
assert.equal(demoPrices['bitcoin-mainnet'].sparkline, null,
    'the demo price entry carries no sparkline: the chart already has a seeded walk, and a '
    + 'second source for the same line is a second thing to keep stable');

for (const [label, ...parts] of [
    ['TotalBalanceHero', 'packages', 'core', 'src', 'shared', 'components', 'TotalBalanceHero.jsx'],
    ['PortfolioChart', 'packages', 'core', 'src', 'shared', 'components', 'PortfolioChart.jsx'],
]) {
    const src = read(...parts);
    assert.match(src, /if \(isDemo\) \{\s*\n\s*setPriceMap\(synthesizeDemoNativePrices\(nativeChainIds\)\);/,
        `${label} must take demo prices from the demo fixtures BEFORE reaching for the live `
        + 'oracle. A demo wallet that asks a third party for a quote is both a network request '
        + 'the demo promises not to make and a coin flip in every capture.');
}
assert.match(read('packages', 'core', 'src', 'shared', 'components', 'HomeTabs.jsx'),
    /<TotalBalanceHero\s*\n\s*rows=\{filteredRows\}\s*\n\s*walletId=\{walletId\}/,
    'HomeTabs must pass walletId to the hero, or the hero cannot tell a demo wallet apart '
    + 'and the demo-price branch above is dead code');

// ─── 4. the demo lane and both capture harnesses are wired to it ───────

const onboardingSrc = read('packages', 'core', 'src', 'shared', 'routes', 'Onboarding.jsx');
assert.match(onboardingSrc, /demoCaptureMnemonic\(\)\s*\n?\s*\|\|\s*cryptoLib\.generateBip39Mnemonic/,
    'handleEnterDemo must prefer the frozen capture mnemonic and fall back to a generated '
    + 'one. The fallback is what keeps a real user on a throwaway wallet.');

const flowsIndex = read('packages', 'core', 'src', 'flows', 'index.js');
for (const name of ['demoCaptureMnemonic', 'DEMO_CAPTURE_FLAG_KEY', 'DEMO_CAPTURE_CLOCK_MS']) {
    assert.ok(flowsIndex.includes(name),
        `flows/index.js must re-export ${name}; the shells reach the flows only through it`);
}

for (const [label, ...parts] of [
    ['extension', 'packages', 'extension', 'scripts', 'capture-listing-screenshots.mjs'],
    ['desktop', 'packages', 'desktop', 'scripts', 'capture-listing-screenshots.mjs'],
]) {
    const src = read(...parts);
    assert.ok(src.includes('DEMO_CAPTURE_FLAG_KEY') && src.includes('DEMO_CAPTURE_CLOCK_MS'),
        `the ${label} capture must import the frozen inputs from flows/demoCapture.js rather `
        + 'than restate them, or the harness and the app it drives can drift apart');
    assert.ok(src.includes('demoCapture.js'),
        `the ${label} capture must read the constants from the app's own module`);
    assert.match(src, /clock\.setFixedTime\(DEMO_CAPTURE_CLOCK_MS\)/,
        `the ${label} capture must freeze the whole page clock, not only the fixtures: the `
        + 'fixtures date their rows against `now` while the UI ages them against its own, so '
        + 'freezing one of the two would advertise a months-old wallet in a store listing');
}

console.log('OK: listing capture is reproducible '
    + `(capture mode off by default, ${clockReads.length}/${clockReads.length} demo clocks `
    + 'injectable, demo chart seeded on a constant, both harnesses freeze mnemonic + clock)');
