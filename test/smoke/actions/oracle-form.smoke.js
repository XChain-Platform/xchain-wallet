// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-30 ("my oracle", PRICE v1 publishing): the form's three
// rails, the publish + read flows, host routes, 3-shell messaging and
// routing, the command-palette + ActionsMenu entries, and the explorer
// oracle lane the consumer list depends on.
//
// The rails are the reason this surface exists at all rather than users
// composing PRICE by hand in the Advanced form:
//   - every publish is inert for 24h and cannot be retracted in that window
//   - a big move against the publisher's own last price takes a typed confirm
//   - the dispensers that will reprice are listed before the signature

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ---- The form ----
const form = read('packages', 'core', 'src', 'shared', 'routes', 'OracleForm.jsx');
assert.match(form, /submitMethods: \{ hw: 'oraclePriceActionHw', software: 'oraclePriceAction' \}/, 'signer dispatch via useActionForm');
assert.match(form, /VERSION: '1'/, 'composes PRICE v1');
assert.match(form, /DEVIATION_TYPED_CONFIRM_PCT/, 'deviation threshold defined');
assert.match(form, /toUpperCase\(\) === 'PUBLISH'/, 'large moves require a typed confirm');
assert.match(form, /takes effect in 24 hours and cannot be withdrawn/, 'update timing rail present');
assert.match(form, /will not price anything for 24 hours/, 'first-publish timing rail present');
assert.match(form, /pairConsumers/, 'consumers listed before signing');
assert.match(form, /oracleConsumers/, 'consumer lookup wired');
assert.match(form, /oracleFeeds/, 'published-pairs list wired');
assert.match(form, /activationCountdownText/, 'effective-at countdown shown');
assert.match(form, /A fraction, not a percentage/, 'fee field states the unit');

// The publish rule that used to be documented backwards: the FIRST price is
// delayed too. A surface that says otherwise sends operators to a dispenser
// that records `invalid: no matching oracle price` for a day with no
// explanation, which is exactly the DISPENSER.md defect fixed in 2026-07-24.
assert.ok(!/takes effect immediately/i.test(form), 'form never claims an immediate first publish');

// "Could not check" must stay distinguishable from "nobody uses this oracle".
assert.match(form, /Could not check which dispensers use this oracle/, 'unsupported consumer lane is stated, not silently empty');

// ---- Flows ----
const action = read('packages', 'core', 'src', 'flows', 'oraclePriceAction.js');
assert.match(action, /action: 'PRICE'/, 'oraclePriceAction composes PRICE');
assert.match(action, /only PRICE v1 \(user oracle\) is publishable/, 'refuses the validator-only v0');
const queries = read('packages', 'core', 'src', 'flows', 'oracleQueries.js');
assert.match(queries, /getOraclePrices/, 'feeds read via getOraclePrices');
assert.match(queries, /'oracle'/, 'consumers read via the dispenser oracle lane');
assert.match(queries, /ORACLE_ACTIVATION_DELAY_S = 86400/, 'activation delay pinned at 24h');

// ---- Confirm surface ----
const decoderSrc = read('packages', 'core', 'src', 'decoder', 'actionDecoder.js');
assert.match(decoderSrc, /action === 'PRICE'/, 'PRICE reaches a dedicated decoder case');
assert.match(decoderSrc, /cannot be changed or withdrawn before then/, 'confirm screen carries the 24h rail');
assert.match(decoderSrc, /published by the validator federation/, 'v0 flagged as not wallet-publishable');

// ---- Host + messaging ----
const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.match(host, /host\.register\('action\.oraclePrice'/, 'PRICE host route');
assert.match(host, /registerHwHandler\('action\.oraclePrice\.hw', oraclePriceAction\)/, 'HW PRICE route');
assert.match(host, /host\.register\('oracle\.feeds'/, 'feeds host route');
assert.match(host, /host\.register\('oracle\.consumers'/, 'consumers host route');
for (const shell of [
    ['packages', 'web', 'src', 'messaging.js'],
    ['packages', 'desktop', 'renderer', 'messaging.js'],
    ['packages', 'extension', 'src', 'popup', 'messaging.js'],
]) {
    const src = read(...shell);
    for (const route of ["'action.oraclePrice'", "'action.oraclePrice.hw'", "'oracle.feeds'", "'oracle.consumers'"]) {
        assert.ok(src.includes(route), `${shell.join('/')} exposes ${route}`);
    }
}

// ---- Shell routing + menus ----
for (const shell of [
    ['packages', 'web', 'src', 'App.jsx'],
    ['packages', 'desktop', 'renderer', 'App.jsx'],
    ['packages', 'extension', 'src', 'popup', 'App.jsx'],
]) {
    const src = read(...shell);
    assert.ok(src.includes('OracleForm'), `${shell.join('/')} imports OracleForm`);
    assert.ok(src.includes("unlockedView === 'oracle'"), `${shell.join('/')} routes oracle`);
    assert.ok(src.includes('onPublishOraclePrice'), `${shell.join('/')} wires the ActionsMenu entry`);
}

const palette = read('packages', 'core', 'src', 'shared', 'commandPalette', 'commandRegistry.js');
assert.match(palette, /create-oracle-price/, 'command palette offers the oracle surface');

// PRICE now has a dedicated form, so the raw Advanced form must say so
// rather than presenting itself as the only way to publish a price.
const advanced = read('packages', 'core', 'src', 'shared', 'routes', 'AdvancedActionsForm.jsx');
assert.match(
    advanced,
    /const ACTIONS_WITH_DEDICATED_FORMS = new Set\(\[[^\]]*'PRICE'/s,
    'PRICE listed as having a dedicated form',
);

console.log('oracle-form smoke: all assertions passed');
