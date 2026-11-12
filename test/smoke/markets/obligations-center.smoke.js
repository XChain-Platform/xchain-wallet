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
// queue route exists with countdown/at-risk/expired states and a
// prefilled Pay-now handoff; the nav badge is wired in LeftNav +
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
assert.match(view, /state !== 'expired'/, 'payable rows split from expired');
assert.match(view, /Expired, awaiting settlement/, 'expired section labeled');
assert.match(view, /Do not pay/, 'expired copy warns against paying');
assert.match(view, /onPay\(\{\s*chainId: row\.chainId,\s*address: row\.address,\s*orderMatchActionIndex: row\.orderMatchActionIndex,\s*\}\)/,
    'Pay now hands the CoinpayForm resume-ref shape');
assert.match(view, /baseUnitsToCoinText\(obligationBaseUnits\(row\.coinAmount\)\)/,
    'amounts render BigInt-safe at coin scale, through the parser that accepts the DECIMAL shape the\n     explorer actually serves - reading it as base units labelled a 0.5 LTC debt "0.5 base units" (D-137)');
assert.match(view, /base units/, 'falls back to labeled base units when unconvertible');
assert.match(view, /coinpayExpiryText\(row\.expiration\)/, 'absolute deadline shown alongside countdown');

// Expired rows never offer Pay now.
assert.match(view, /\{row\.state !== 'expired' \? \(\s*<Button/, 'Pay now gated off expired state');

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
    'LeftNav view group covers the queue and payment drilldown');
assert.ok(SIDEBAR_SECONDARY_DESTINATIONS.includes('obligations'), 'LeftNav item');
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
    assert.match(app, /setResumeCoinpay\(\{ \.\.\.ref, from: 'obligations' \}\)/, `${label}: Pay now prefills CoinpayForm`);
    assert.match(app, /from === 'obligations'\s*\?\s*'obligations'/, `${label}: CoinpayForm backs out to the queue`);
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
assert.match(form, /EXPIRED, do not pay/, 'picker marks expired rows');

console.log('obligations-center smoke: all assertions passed');
