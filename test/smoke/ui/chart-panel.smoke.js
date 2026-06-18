// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Phase 3 Step 3 smoke: Chart panel (§41.3.1).
//
// Runtime coverage of the bucketize helper (pure, Node-safe) plus
// static wiring checks for the MarketChart component + package.json
// dep declarations.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bucketizeMatches, PERIODS, DEFAULT_PERIOD_ID } from '../../../packages/core/src/market/bucketize.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desk = join(wsRoot, 'packages', 'desktop');

// --- 1. Period constants ----------------------------------------

const periodIds = PERIODS.map((p) => p.id);
for (const id of ['1m', '5m', '15m', '1h', '4h', '1d', '1w']) {
    assert.ok(periodIds.includes(id), `PERIODS includes ${id}`);
}
assert.equal(DEFAULT_PERIOD_ID, '1h', 'default period is 1h');

// --- 2. bucketizeMatches: empty / degenerate inputs ------------

assert.deepEqual(bucketizeMatches([], { tick1: 'A', tick2: 'B', periodSeconds: 60 }), []);
assert.deepEqual(bucketizeMatches(null, { tick1: 'A', tick2: 'B', periodSeconds: 60 }), []);
assert.deepEqual(
    bucketizeMatches([{}], { tick1: '', tick2: 'B', periodSeconds: 60 }),
    [],
    'empty tick1 yields no candles',
);
assert.deepEqual(
    bucketizeMatches([{}], { tick1: 'A', tick2: 'B', periodSeconds: 0 }),
    [],
    'zero period yields no candles',
);

// --- 3. Bucketing + OHLCV math ----------------------------------

// MYTOKEN / BTC: give_tick=MYTOKEN means price = get / give.
// Bucket = 1h = 3600s. Put three matches in the same bucket + one
// in the next bucket and verify open/high/low/close + volume.
const rows = [
    // Bucket starting at 3600 (01:00:00 UTC).
    { give_tick: 'MYTOKEN', get_tick: 'BTC', give_amount: 100, get_amount: 0.5, timestamp: 3600 },     // price 0.005
    { give_tick: 'MYTOKEN', get_tick: 'BTC', give_amount: 50,  get_amount: 0.30, timestamp: 3900 },    // price 0.006
    { give_tick: 'BTC', get_tick: 'MYTOKEN', give_amount: 0.2, get_amount: 50,   timestamp: 3660 },    // price 0.004 (reversed)
    // Bucket starting at 7200 (02:00:00 UTC).
    { give_tick: 'MYTOKEN', get_tick: 'BTC', give_amount: 10,  get_amount: 0.055, timestamp: 7500 },   // price 0.0055
];
const candles = bucketizeMatches(rows, { tick1: 'MYTOKEN', tick2: 'BTC', periodSeconds: 3600 });
assert.equal(candles.length, 2, 'two buckets');
const first = candles[0];
const second = candles[1];
assert.equal(first.time, 3600);
// The open match landed at ts=3600 with price 0.005 (MYTOKEN→BTC).
assert.ok(Math.abs(first.open - 0.005) < 1e-12, `expected open 0.005, got ${first.open}`);
assert.ok(Math.abs(first.high - 0.006) < 1e-12, `expected high 0.006, got ${first.high}`);
assert.ok(Math.abs(first.low - 0.004) < 1e-12, `expected low 0.004, got ${first.low}`);
// Close match landed at ts=3900 with price 0.006.
assert.ok(Math.abs(first.close - 0.006) < 1e-12, `expected close 0.006, got ${first.close}`);
// Volume in tick1 (MYTOKEN): 100 + 50 + 50 (the reversed match's get_amount in MYTOKEN).
assert.ok(Math.abs(first.volume - 200) < 1e-9, `expected volume 200, got ${first.volume}`);

assert.equal(second.time, 7200);
assert.ok(Math.abs(second.open - 0.0055) < 1e-12);
assert.ok(Math.abs(second.close - 0.0055) < 1e-12);

// --- 4. Rows with mismatched pair are skipped -------------------

const skipped = bucketizeMatches(
    [
        { give_tick: 'OTHER', get_tick: 'BTC', give_amount: 1, get_amount: 1, timestamp: 3600 },
    ],
    { tick1: 'MYTOKEN', tick2: 'BTC', periodSeconds: 3600 },
);
assert.deepEqual(skipped, [], 'rows whose pair does not match tick1/tick2 are dropped');

// --- 5. MarketChart component static wiring ---------------------

const chartPath = join(core, 'src', 'shared', 'components', 'MarketChart.jsx');
assert.ok(existsSync(chartPath), 'MarketChart.jsx exists');
const chartSrc = readFileSync(chartPath, 'utf8');
assert.ok(/export function MarketChart\b/.test(chartSrc),
    'MarketChart is a named export');
assert.ok(/await import\('lightweight-charts'\)/.test(chartSrc),
    'MarketChart dynamically imports lightweight-charts (lazy, Node-safe)');
assert.ok(/addLineSeries/.test(chartSrc),
    'MarketChart renders a line series');
assert.ok(/messaging\.getMarketHistory\(/.test(chartSrc),
    'MarketChart fetches via messaging.getMarketHistory');
assert.ok(/bucketizeMatches/.test(chartSrc),
    'MarketChart aggregates via bucketizeMatches');
assert.ok(/setPeriodId\(/.test(chartSrc),
    'MarketChart exposes a period toggle');

// --- 6. Dep declared in every shell -----------------------------

for (const [shell, pkgPath] of [
    ['extension', join(ext, 'package.json')],
    ['web', join(web, 'package.json')],
    ['desktop', join(desk, 'package.json')],
]) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    assert.ok(
        pkg.dependencies && pkg.dependencies['lightweight-charts'],
        `${shell}/package.json declares lightweight-charts`,
    );
}

console.log(
    'OK: chart-panel smoke (bucketizeMatches OHLCV orientation + volume aggregation + period boundary math + mismatched-pair rows dropped; PERIODS constant covers 7 granularities with 1h default; MarketChart dynamically imports lightweight-charts, fetches via messaging.getMarketHistory, renders line series with period toggle; lightweight-charts declared in extension + web + desktop package.json)',
);
