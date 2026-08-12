// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for P8: BET composes through the SDK's own builder, host-side.
//
// Same rule the VOTE route follows, and BET has a sharper reason to
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

// --- 5. the place-bet surface composes through the route --------------

{
    const src = read('packages', 'core', 'src', 'shared', 'routes', 'BetFeedDetail.jsx');
    assert.match(src, /messaging\.composeBetForConfirm\(\{/,
        'BetFeedDetail composes through the BET builder route');
    assert.ok(src.includes("builder: 'placeBetParams'"), 'BetFeedDetail names the placeBetParams builder');

    // One derivation feeding BOTH compose and submit. Two would be free to
    // diverge, and the divergence would be signed rather than caught.
    assert.match(src, /function betParams\(\)/, 'BetFeedDetail derives the bet input in one place');
    // The window is a proximity heuristic for "compose and submit are handed the
    // SAME derivation", not a line budget; it widened when threaded the
    // native-fee flag (and its comment) through both calls.
    assert.match(src, /params: betParams\(\),[\s\S]{0,600}params: betParams\(\),/,
        'BetFeedDetail composes and submits the same betParams()');

    // The generic compose route would mean a client-side wire mirror.
    assert.ok(!/actionData: \{ action: 'BET'/.test(src),
        'BetFeedDetail does not feed a client-side wire mirror into the signing path');

    // §6 format 2: the feed's own source may not bet on its own market, so the
    // form is hidden rather than left to be rejected on-chain after paying a fee.
    assert.match(src, /feed\.source === fromAddress\.address/,
        "BetFeedDetail hides the bet form for the market's own oracle");

    // Payout projection must not be a local approximation.
    assert.match(src, /messaging\.betProjectPayout\(/,
        'BetFeedDetail projects payout through the SDK, not a local estimate');
}

// --- 6. the oracle console composes through the route too --------------

{
    const src = read('packages', 'core', 'src', 'shared', 'routes', 'OracleConsole.jsx');
    assert.match(src, /messaging\.composeBetForConfirm\(\{/,
        'OracleConsole composes through the BET builder route');
    for (const b of ['resolveMarketParams', 'cancelMarketParams']) {
        assert.ok(src.includes(`'${b}'`), `OracleConsole names the ${b} builder`);
    }
    assert.ok(!/actionData: \{ action: 'BET'/.test(src),
        'OracleConsole does not feed a client-side wire mirror into the signing path');

    // Resolve is legal only between the deadline and the end of the refund
    // window, so the button is offered only where the chain would accept it
    // rather than letting the user pay a fee for a rejected transaction.
    assert.match(src, /canResolve\s*=\s*f\.feed_status === 'closed'/,
        'OracleConsole only offers resolve once betting has closed');
    assert.match(src, /Number\(f\.expire_at\) > nowSec/,
        'OracleConsole only offers resolve before the refund window ends');
}

// --- 7. MyBets aggregates across every address ------------------------

{
    const src = read('packages', 'core', 'src', 'shared', 'routes', 'MyBets.jsx');
    // Address-aggregated, not active-address-scoped: bets are keyed to the
    // address that placed them and payouts credit that same address, so a
    // per-address view would quietly hide money.
    assert.match(src, /getAddressesByChain\(walletId, accountId\)/,
        'MyBets enumerates every address rather than the active one');
    assert.match(src, /type: 'address'/, 'MyBets queries bets by bettor address');
}

// --- 8. the confirm screen decodes BET rather than falling back --------

const decoderSrc = read('packages', 'core', 'src', 'decoder', 'actionDecoder.js');
assert.match(decoderSrc, /if \(action === 'BET'\)/,
    'decodeAction has a BET branch, so a BET confirm is not raw params');
assert.match(decoderSrc, /function decodeBet\(/, 'the BET decoder exists');

// --- 9. the create form composes through the route, and prices the market ---

{
    const src = read('packages', 'core', 'src', 'shared', 'routes', 'CreateBetFeedForm.jsx');
    assert.match(src, /messaging\.composeBetForConfirm\(\{/,
        'CreateBetFeedForm composes through the BET builder route');
    assert.ok(src.includes("builder: 'createMarketParams'"),
        'CreateBetFeedForm names the createMarketParams builder');
    assert.ok(!/actionData: \{ action: 'BET'/.test(src),
        'CreateBetFeedForm does not feed a client-side wire mirror into the signing path');
    // One derivation feeding both compose and submit, as in BetFeedDetail (same
    // proximity heuristic, same widening).
    assert.match(src, /params: marketParams,[\s\S]{0,600}params: marketParams,/,
        'CreateBetFeedForm composes and submits the same marketParams');

    // The §11.3 live duration-fee display, which the spec calls load-bearing
    // rather than polish: the charge is keyed on expire_at, so extending only
    // the refund window (which a user reads as a safety margin, not a price) is
    // what pushes a market past the free window.
    assert.match(src, /messaging\.betProjectFeedCreateFee\(\{/,
        'CreateBetFeedForm quotes the market cost through the SDK helper');
    assert.match(src, /refundWindow: refundSeconds/,
        'the quote is keyed on the refund window, not only the betting deadline');

    // OUTCOMES and DETAILS are composed together so they cannot disagree (the
    // indexer rejects a create whose DETAILS.outcomes differ from OUTCOMES).
    assert.match(src, /title: label\.trim\(\)/,
        "the DETAILS title is derived from the market's own label");
}

// --- 10. every BET surface RENDERS the confirm page it opens -------------

// The confirm flow opens a phase and waits for Approve. A screen that opens it
// without drawing it strands the action AND holds the module-level confirm
// singleton, which makes every other form in the wallet reject as busy. All
// three BET write surfaces must therefore render it, and must read the password
// through a real ref: Approve runs from the closure captured when the page
// OPENED, so `{ current: password }` (a fresh object per render) hands the
// submit an empty string.
for (const route of ['BetFeedDetail', 'OracleConsole', 'CreateBetFeedForm']) {
    const src = read('packages', 'core', 'src', 'shared', 'routes', `${route}.jsx`);
    assert.match(src, /import \{ ActionConfirmScreen \}/, `${route} imports the confirm page`);
    assert.match(src, /if \(actionConfirm\.open\)/, `${route} renders the confirm page it opens`);
    assert.match(src, /<ActionConfirmScreen/, `${route} renders ActionConfirmScreen`);
    assert.match(src, /passwordRef: passwordValueRef/,
        `${route} reads the confirm-page password through a live ref`);
    assert.ok(!/passwordRef: \{ current: password \}/.test(src),
        `${route} does not capture a stale password object`);
}

// --- 11. the shells route the whole family, and BET is authorable --------

for (const [shell, ...p] of [
    ['extension', 'packages', 'extension', 'src', 'popup', 'App.jsx'],
    ['web', 'packages', 'web', 'src', 'App.jsx'],
    ['desktop', 'packages', 'desktop', 'renderer', 'App.jsx'],
]) {
    const src = read(...p);
    for (const c of ['BetFeedsList', 'BetFeedDetail', 'CreateBetFeedForm', 'MyBets', 'OracleConsole', 'OracleRecord']) {
        assert.ok(src.includes(`import { ${c} }`), `${shell}: imports ${c}`);
        assert.ok(src.includes(`<${c}`), `${shell}: renders ${c}`);
    }
    for (const view of ['bet-markets', 'bet-market-detail', 'bet-create', 'my-bets', 'bet-oracle-console', 'bet-oracle-record']) {
        assert.ok(src.includes(`'${view}'`), `${shell}: routes the ${view} view`);
    }
    // Reachable from the menu, not merely present in the bundle.
    assert.match(src, /onBetting: \(\) => setUnlockedView\('bet-markets'\)/,
        `${shell}: the actions menu opens the betting hub`);
    assert.match(src, /onSelect: onBetting/, `${shell}: the betting menu entry is wired`);
    // The oracle record has no menu entry by design: it is a question about ONE
    // oracle and needs an address as its subject, so the market page is its only
    // door. That makes this handler the whole reachability story - the route
    // shipped once already with the prop declared and nobody passing it.
    assert.match(src, /onOpenOracle=\{\(chainId, address\) =>/,
        `${shell}: the market page hands the oracle address to the record view`);
    assert.ok(src.includes("setUnlockedView('bet-oracle-record')"),
        `${shell}: nothing opens the oracle record`);
}

{
    // The registry moves in lockstep with the manifest's walletForm flag; the
    // ActionManifestConformance unit guard fails if these two ever disagree.
    const reg = read('packages', 'core', 'src', 'registry', 'actions.js');
    const commonIdx = reg.indexOf('export const COMMON_ACTIONS');
    const protocolIdx = reg.indexOf('export const PROTOCOL_ONLY_ACTIONS');
    assert.ok(reg.slice(commonIdx, protocolIdx).includes("'BET'"),
        'BET is an authorable action now that it has a form');
    assert.ok(!reg.slice(protocolIdx).includes("'BET'"),
        'BET is no longer listed as protocol-only');

    const manifest = JSON.parse(read('test', 'fixtures', 'action-manifest.json'));
    assert.equal(manifest.actions.BET.walletForm, true,
        'the manifest records the BET wallet form');
}

console.log(
    'OK: bet compose-for-confirm smoke (P8: action.bet.composeForConfirm runs the real'
    + 'sdk.betting builder host-side with an allow-listed builder name and returns betParams; all 4 '
    + 'formats have their own software + hardware routes; all 3 shells export the read and write '
    + 'surfaces; each composer is nailed to one builder so a place-bet can never reach the resolve '
    + 'builder; and decodeAction has a BET branch so the confirm screen is not raw params. Plus the '
    + 'P8 completion legs: CreateBetFeedForm composes through the same route and quotes the market '
    + 'cost off the REFUND deadline; all three write surfaces render the confirm page they open and '
    + 'read its password through a live ref; all three shells route the five views and reach them '
    + 'from the actions menu; and BET is authorable in the registry in lockstep with the manifest)',
);
