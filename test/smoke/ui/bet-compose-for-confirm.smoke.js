// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  P8: BET composes through the SDK's own builder, host-side.
//
// Same rule the VOTE route follows , and BET has a sharper reason to
// need it. A resolve (v3) and a place-bet (v2) differ on the wire only by
// AMOUNT, so a client-side wire mirror that drifts by one field turns an
// intended stake into a payout decision. It would not fail loudly either: the
// tamper check verifies the composed PSBT against the params the encoder was
// HANDED, so a wrong mirror yields a self-consistent PSBT for the WRONG action,
// and `prebuiltPsbt` short-circuits the rebuild that would have caught it.
//
// The SDK builders PIN the version for the same reason, which is only worth
// anything if the wallet actually routes through them.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// --- 1. the host route ------------------------------------------------

const hostSrc = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.match(hostSrc, /host\.register\('action\.bet\.composeForConfirm'/,
    'the BET compose route is registered');
assert.match(hostSrc, /sdk\.betting\[builder\]\(req\?\.params\)/,
    'the route runs the real sdk.betting builder on the caller-supplied input');
assert.match(hostSrc, /betParams: params/,
    'the built wire params ride back so the confirm page decodes what was composed');

{
    const routeIdx = hostSrc.indexOf("host.register('action.bet.composeForConfirm'");
    const route = hostSrc.slice(routeIdx, routeIdx + 3000);
    assert.match(route, /BET_BUILDERS\s*=\s*\[/, 'the builder name is allow-listed');
    for (const b of ['createMarketParams', 'placeBetParams', 'resolveMarketParams', 'cancelMarketParams']) {
        assert.ok(route.includes(`'${b}'`), `allow-list covers ${b}`);
    }
    assert.match(route, /BET_BUILDERS\.includes\(builder\)/, 'an unlisted builder is rejected');
}

// --- 2. every BET write route is registered, software and hardware ------

// Each format gets its own route rather than one route taking a version from
// the caller: the messaging boundary is not a place to infer v2 vs v3.
for (const route of ['action.createMarket', 'action.placeBet', 'action.resolveMarket', 'action.cancelMarket']) {
    assert.ok(hostSrc.includes(`host.register('${route}'`), `${route} is registered`);
    assert.ok(hostSrc.includes(`registerHwHandler('${route}.hw'`), `${route}.hw is registered`);
}

// --- 3. all three shells expose the same surface ----------------------

for (const [shell, ...p] of [
    ['extension', 'packages', 'extension', 'src', 'popup', 'messaging.js'],
    ['web', 'packages', 'web', 'src', 'messaging.js'],
    ['desktop', 'packages', 'desktop', 'renderer', 'messaging.js'],
]) {
    const src = read(...p);
    assert.match(src, /export function composeBetForConfirm\(opts\)/,
        `${shell}: composeBetForConfirm is exported`);
    assert.match(src, /sendMessage\('action\.bet\.composeForConfirm', opts\)/,
        `${shell}: routed to the BET compose route`);
    for (const fn of ['createMarketAction', 'placeBetAction', 'resolveMarketAction', 'cancelMarketAction']) {
        assert.ok(src.includes(`export function ${fn}(opts)`), `${shell}: ${fn} is exported`);
        assert.ok(src.includes(`export function ${fn}Hw(opts)`), `${shell}: ${fn}Hw is exported`);
    }
    // BET reads too, so a shell cannot ship the write half without the browse half.
    for (const fn of ['betFeeds', 'betFeed', 'bets', 'betOracle']) {
        assert.ok(src.includes(`export function ${fn}(req)`), `${shell}: ${fn} read is exported`);
    }
}

// --- 4. the composers are nailed to one builder each ------------------

// This is the property the whole smoke exists for: if placeBetAction ever
// reached resolveMarketParams, a user staking money would instead be settling
// the market.
const actionsSrc = read('packages', 'core', 'src', 'flows', 'betActions.js');
for (const [fn, builder] of [
    ['createMarketAction', 'createMarketParams'],
    ['placeBetAction', 'placeBetParams'],
    ['resolveMarketAction', 'resolveMarketParams'],
    ['cancelMarketAction', 'cancelMarketParams'],
]) {
    const idx = actionsSrc.indexOf(`export async function ${fn}(`);
    assert.ok(idx !== -1, `${fn} is exported`);
    const body = actionsSrc.slice(idx, idx + 900);
    assert.ok(body.includes(`'${builder}'`), `${fn} submits through ${builder}`);
}
assert.match(actionsSrc, /actionData: \{ action: 'BET', params \}/,
    'betActions submits a BET action built from the SDK params');

// --- 5. the confirm screen decodes BET rather than falling back --------

const decoderSrc = read('packages', 'core', 'src', 'decoder', 'actionDecoder.js');
assert.match(decoderSrc, /if \(action === 'BET'\)/,
    'decodeAction has a BET branch, so a BET confirm is not raw params');
assert.match(decoderSrc, /function decodeBet\(/, 'the BET decoder exists');

console.log(
    'OK: bet compose-for-confirm smoke ( P8: action.bet.composeForConfirm runs the real '
    + 'sdk.betting builder host-side with an allow-listed builder name and returns betParams; all 4 '
    + 'formats have their own software + hardware routes; all 3 shells export the read and write '
    + 'surfaces; each composer is nailed to one builder so a place-bet can never reach the resolve '
    + 'builder; and decodeAction has a BET branch so the confirm screen is not raw params)',
);
