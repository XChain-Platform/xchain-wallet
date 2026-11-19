// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-15 (COINPAY obligations center): the ObligationsView
// list of payments due exists with a live time ring per row, the bought
// side read in bulk and a prefilled pay handoff; the nav badge is wired in LeftNav +
// BottomTabBar and fed by ONE CoinpayObligationsProvider scan in the web and
// desktop shells; CoinpayForm gained the expired funds-safety block.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTE_NAV_GROUPS, SIDEBAR_SECONDARY_DESTINATIONS } from '../../../packages/core/src/shared/routeRegistry.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ---- Queue route ----------------------------------------------------
const view = read('packages', 'core', 'src', 'shared', 'routes', 'ObligationsView.jsx');
assert.match(view, /useCoinpayObligations\(/, 'view scans via the shared hook');
assert.match(view, /classifyObligation\(o\.expiration, nowSec\)/, 'rows classified against a live clock');
assert.match(view, /setInterval\(\(\) => setNowSec/, '1s ticker drives the countdowns');
// The Payments due glance (operator 2026-11-13, simplified layout 1): one
// list card of the payments whose window is open, each row a time ring, what
// it buys, what it pays and a chevron; a tap opens the payment's detail.
// Expired rows are never listed, so nothing on the page can pay one.
assert.match(view, /\.filter\(\(o\) => o\.state !== 'expired'\)/, 'expired payments fall off the list');
assert.doesNotMatch(view, /Do not pay|chipExpired/, 'no expired row or chip is drawn');
assert.match(view, /onPay\(\{\s*chainId: row\.chainId,\s*address: row\.address,\s*orderMatchActionIndex: row\.orderMatchActionIndex,\s*\}\)/,
    'the row tap hands the CoinpayForm resume-ref shape');
assert.match(view, /baseUnitsToCoinText\(obligationBaseUnits\(row\.coinAmount\)\)/,
    'amounts render BigInt-safe at coin scale, through the parser that accepts the DECIMAL shape the\n     explorer actually serves - reading it as base units labelled a 0.5 LTC debt "0.5 base units" (D-137)');
assert.match(view, /base units/, 'falls back to labeled base units when unconvertible');
assert.match(view, /<FillRing[\s\S]*?mark="clock"/, 'each row shows the time ring');
assert.match(view, /shortTimeLeft\(row\.secondsLeft\)/, 'the ring caption is the live time left');
assert.match(view, /<PairIcons /, 'rows lead with the pair icons');
assert.match(view, /<ListFilterMenu[\s\S]{0,300}label="Filter payments due"/, 'header carries the filter');

// What each payment buys comes from ONE call for the whole list, keyed on
// the payments' identities, never one read per row.
assert.match(view, /messaging\.getCoinpayMatchSides\(\{ obligations: latest\.current \}\)/, 'one bulk read answers every row');
assert.doesNotMatch(view, /getActionByIndex/, 'the list never reads a match per row');
const sidesFlow = read('packages', 'core', 'src', 'flows', 'coinpayMatchSides.js');
assert.match(sidesFlow, /sdk\.getOrderMatches\(g\.address, 'address'\)/, 'matches read per payer address');
assert.match(sidesFlow, /sdk\.getOrders\(g\.address, 'address'\)/, 'orders read per payer address');
const hostSrc = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.match(hostSrc, /host\.register\('coinpays\.matchSides'/, 'host answers the bulk read');
for (const p of [
    ['packages', 'web', 'src', 'messaging.js'],
    ['packages', 'desktop', 'renderer', 'messaging.js'],
    ['packages', 'extension', 'src', 'popup', 'messaging.js'],
]) {
    assert.match(read(...p), /export function getCoinpayMatchSides\(req\)[\s\S]{0,120}'coinpays\.matchSides'/, `${p[1]}: messaging wires the bulk read`);
}

// ---- Shared hook ------------------------------------------------------
const hook = read('packages', 'core', 'src', 'shared', 'hooks', 'useCoinpayObligations.js');
assert.match(hook, /export async function scanCoinpayObligations/, 'pure scan exported for unit tests');
assert.match(hook, /getCoinpayObligationsForAddress/, 'scan uses the existing messaging method');
assert.match(hook, /isDemoWallet/, 'demo wallet never scans the explorer');
assert.match(hook, /visibilitychange/, 'refreshes on tab refocus');
assert.match(hook, /payableCount/, 'exposes the badge count');
assert.match(hook, /state !== 'expired'/, 'badge counts only payable rows');

// ---- Status classification -------------------------------------------
const status = read('packages', 'core', 'src', 'market', 'obligationStatus.js');
assert.match(status, /AT_RISK_SECONDS = 30 \* 60/, 'at-risk threshold is 30 minutes (PC-16 retry cutoff)');
assert.match(status, /secondsLeft <= 0\) return \{ state: 'expired'/, 'T=0 is expired, never payable');

// ---- Nav wiring --------------------------------------------------------
const leftNav = read('packages', 'core', 'src', 'shared', 'components', 'LeftNav.jsx');
assert.deepEqual(ROUTE_NAV_GROUPS.obligations, ['obligations', 'coinpay'],
    'the route section covers the queue and payment drilldown');
assert.ok(!SIDEBAR_SECONDARY_DESTINATIONS.includes('obligations'),
    'Payments due stays in the complete wallet menu');
const walletMenuSrc = read('packages', 'core', 'src', 'shared', 'walletMenu.js');
assert.match(walletMenuSrc, /id: 'obligations', labelKey: 'walletMenu\.row\.paymentsDue', icon: 'ClockIcon'/,
    'wallet menu catalogue row carries the Payments due label and ClockIcon');
// The menu, sidebar and tab bar carry no unread counts, so no badge reaches the nav.
assert.doesNotMatch(leftNav, /badges/, 'LeftNav takes no badges');

const icons = read('packages', 'core', 'src', 'ui', 'icons', 'index.jsx');
assert.match(icons, /export function ClockIcon/, 'ClockIcon exists');

const paletteSrc = read('packages', 'core', 'src', 'shared', 'commandPalette', 'commandRegistry.js');
assert.match(
    paletteSrc,
    /for \(const group of visibleWalletMenu\(ctx\)\)[\s\S]*?id: CATALOGUE_COMMAND_IDS\[row\.id\] \|\| `nav-\$\{row\.id\}`[\s\S]*?run: row\.id === 'scan'[\s\S]*?: go\(row\.id\)/,
    'catalogue rows become command palette entries with the normal navigation fallback',
);
assert.match(paletteSrc, /obligations: \{ subtitleKey: 'palette\.navObligations\.subtitle'/, 'command palette obligations meta');

// ---- Shell wiring (web + desktop) --------------------------------------
for (const [label, ...p] of [
    ['web', 'packages', 'web', 'src', 'App.jsx'],
    ['desktop', 'packages', 'desktop', 'renderer', 'App.jsx'],
]) {
    const app = read(...p);
    // One scan per tree (rate-limits spec, row 29): the provider wraps the
    // unlocked tree and the nav reads the count from the shared hook, so a
    // second bare hook call here would be the duplicate scan coming back.
    assert.match(app, /<CoinpayObligationsProvider walletId=\{activeWalletId\} accountId=\{activeAccountId\}>/, `${label}: obligations provider wraps the unlocked tree`);
    assert.doesNotMatch(app, /badges=/, `${label}: no badge is fed to nav`);
    assert.doesNotMatch(app, /useCoinpayObligations\(activeWalletId/, `${label}: no second scan beside the provider`);
    assert.match(app, /unlockedView === 'obligations' && activeWalletId/, `${label}: obligations view routed`);
    assert.match(app, /onPay=\{\(ref\) => \{\s*setResumeCoinpay\(ref\);\s*setUnlockedView\('coinpay'\);/, `${label}: Pay now prefills CoinpayForm`);
    // Back pops the shell's history, so CoinpayForm returns to the queue
    // when Pay now opened it there.
    assert.match(app, /setResumeCoinpay\(null\);\s*goBack\(\);/, `${label}: CoinpayForm backs out to the page it came from`);
    assert.match(app, /'coinpay' \| 'obligations' \|/, `${label}: view union includes obligations`);
}

// ---- CoinpayForm funds-safety block ------------------------------------
const form = read('packages', 'core', 'src', 'shared', 'routes', 'CoinpayForm.jsx');
assert.match(form, /classifyObligation\(summary\.expiration\)\.state === 'expired'/, 'form blocks expired obligations');
assert.match(form, /This payment window has expired/, 'expired copy explains the loss mode');
// The block runs at BOTH gates: advance-to-review and sign-time.
const reviewIdx = form.indexOf('function handleReview');
const submitIdx = form.indexOf('async function handleSubmit');
assert.ok(reviewIdx > 0 && submitIdx > 0, 'both handlers present');
assert.match(form.slice(reviewIdx, submitIdx), /EXPIRED_ERROR/, 'review gate checks expiry');
assert.match(form.slice(submitIdx), /EXPIRED_ERROR/, 'sign gate re-checks expiry');
// The picker's state pill now reads in sentence case (no capitals for emphasis).
assert.match(form, /pillUrgent\}`\}>Expired, do not pay</, 'picker marks expired rows');

console.log('obligations-center smoke: all assertions passed');
