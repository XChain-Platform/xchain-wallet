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
// BottomTabBar and fed by useCoinpayObligations in the web and
// desktop shells; CoinpayForm gained the expired funds-safety block.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
assert.match(view, /baseUnitsToCoinText\(row\.coinAmount\)/, 'amounts render BigInt-safe at coin scale');
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
assert.match(leftNav, /obligations: \['obligations'\]/, 'LeftNav view group');
assert.match(leftNav, /id: 'obligations', label: 'Payments due', Icon: Icon\.ClockIcon/, 'LeftNav item');
// Secondary rows must render badge pills (the obligations item lives there).
const secondaryBlock = leftNav.slice(leftNav.indexOf('{secondary.map'));
assert.match(secondaryBlock, /badges\[item\.id\] > 0/, 'secondary nav rows render badges');

const tabBar = read('packages', 'core', 'src', 'shared', 'components', 'BottomTabBar.jsx');
assert.match(tabBar, /id: 'obligations', label: 'Payments due', Icon: Icon\.ClockIcon, group: \['obligations'\]/,
    'BottomTabBar sheet row (badge + More-dot ride the existing sheet logic)');

const icons = read('packages', 'core', 'src', 'ui', 'icons', 'index.jsx');
assert.match(icons, /export function ClockIcon/, 'ClockIcon exists');

const paletteSrc = read('packages', 'core', 'src', 'shared', 'commandPalette', 'commandRegistry.js');
assert.match(paletteSrc, /id: 'nav-obligations'[\s\S]*?run: go\('obligations'\)/, 'command palette entry');

// ---- Shell wiring (web + desktop) --------------------------------------
for (const [label, ...p] of [
    ['web', 'packages', 'web', 'src', 'App.jsx'],
    ['desktop', 'packages', 'desktop', 'renderer', 'App.jsx'],
]) {
    const app = read(...p);
    assert.match(app, /useCoinpayObligations\(activeWalletId, activeAccountId\)/, `${label}: badge hook mounted`);
    assert.match(app, /badges=\{\{ messaging: messagingUnread, obligations: obligationsDue \}\}/, `${label}: badge fed to nav`);
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
