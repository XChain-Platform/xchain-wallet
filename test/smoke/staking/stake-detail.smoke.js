// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the staking position detail page (§42.7.4 drill-in):
// StakeDetail, the coin page's layout (G10 chart hero, G13 icon tabs with
// Actions first, the shared action list of G101) with a validator variant
// (Claimable and Earned bubbles; Add stake / Unstake / Claim / Delegate /
// Revoke rows; Rewards and Details tabs, plus Validator for an address on the
// validator roster, which replaced the retired Operator Dashboard) and a
// contract variant (Add stake / Unstake / Delegate / View contract rows;
// Positions, Penalties, Details).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const detailPath = join(sharedRoutes, 'StakeDetail.jsx');
assert.ok(existsSync(detailPath), 'StakeDetail.jsx exists');
const src = readFileSync(detailPath, 'utf8');

// 1. Component export + kind switch
assert.ok(/export function StakeDetail\b/.test(src),
    'StakeDetail is a named export');
assert.ok(/'validator' \| 'contract'/.test(src),
    'StakeDetail documents the validator|contract kind prop');

// 2. The coin page's layout, reused rather than copied: Home's hero styles
// with the chart behind (G10), Token Detail's tabs, the shared ActionList
// (G101) in place of the retired square tiles, and no hero details list or
// More menu.
for (const [pattern, what] of [
    [/homeTabsStyles\.heroStack/, 'the Home hero stack'],
    [/heroStyles\.hero\b/, 'the Home hero card'],
    [/portfolioChartStyles\.behind/, 'the chart drawn behind the card'],
    [/<ChartRangeTabs\b/, 'the shared range chips'],
    [/<Sparkline\b/, 'the shared Sparkline'],
    [/tokenDetailStyles\.detailTabs/, 'the coin page tab row'],
    [/<ActionList label="Stake actions">/, 'the shared action list'],
    [/<ActionListItem\b/, 'the shared action row'],
]) {
    assert.ok(pattern.test(src), `StakeDetail uses ${what}`);
}
assert.ok(!/styles\.detailsList|local\.quickActions|aria-haspopup="menu"/.test(src),
    'StakeDetail has no hero details list, old quick-action row or More menu');
assert.ok(!/QuickActionTile|assetActionGrid/.test(src), 'StakeDetail draws no square action tiles (G101)');
// The range chips inherit Home's complete approved set and ordering.
assert.ok(/RANGES as CHART_RANGES/.test(src) && /const STAKE_RANGES = CHART_RANGES/.test(src),
    'StakeDetail uses Home\'s complete 24h to All range chips');
assert.ok(/showScale/.test(src) && /heroScale/.test(src),
    'StakeDetail uses the shared Hero 2 five-value scale and halfway guides');
// Actions is the default tab and uses the Zap icon; Details uses Info.
assert.ok(/useState\('actions'\)/.test(src), 'StakeDetail opens on the Actions tab');
assert.ok(/id: 'actions', label: tabLabel\(Icon\.ZapIcon/.test(src), 'Actions carries the Zap icon');
assert.ok(/id: 'details', label: tabLabel\(Icon\.InfoIcon/.test(src), 'Details carries the Info icon');

// 3. Validator variant: bubbles, tiles, tabs.
for (const label of ['Claimable', 'Earned', 'Delegated to', 'Staked on', 'Cooldown left', 'Lock terms']) {
    assert.ok(src.includes(label), `StakeDetail renders "${label}"`);
}
for (const action of ["'Add stake'", "'Unstake'", "'Claim'", "'Delegate'", "'Revoke'", "'Withdraw'", "'Stake again'"]) {
    assert.ok(src.includes(action), `StakeDetail offers ${action}`);
}
// The Operator Dashboard is retired: its validator figures are the Validator
// tab, shown only for an address with its own roster row.
assert.ok(!/Operator View|onOpenOperatorDashboard/.test(src), 'StakeDetail has no Operator View tile');
assert.ok(/ownValidatorRow\(\{ validators, signingPubkey: delegatedKey, address \}\)/.test(src),
    'StakeDetail matches its roster row through the shared helper');
assert.ok(/\.\.\.\(ownValidator \? \[\{ id: 'validator', label: tabLabel\(Icon\.VerifyIcon, 'Validator'\) \}\] : \[\]\)/.test(src),
    'StakeDetail adds the Validator tab only for its own roster row');
for (const label of ['Status', 'Uptime', 'Score', 'Votes recorded', 'Missed', 'Last seen block', 'Signing key', 'Validator not active yet']) {
    assert.ok(src.includes(`'${label}'`) || src.includes(`"${label}"`), `the Validator tab shows "${label}"`);
}
assert.ok(!existsSync(join(sharedRoutes, 'OperatorDashboard.jsx')), 'OperatorDashboard.jsx is retired');
for (const tab of ["id: 'actions'", "id: 'rewards'", "id: 'details'"]) {
    assert.ok(src.includes(tab), `StakeDetail has validator tab ${tab}`);
}
assert.ok(!src.includes("id: 'delegation'"), 'StakeDetail has no Delegation tab');
// No demo-wallet notice: a demo wallet's actions stay enabled and its form refuses the broadcast.
assert.ok(!/demo wallets? can/i.test(src), 'StakeDetail shows no demo-wallet notice');

// 4. Contract variant: positions/slashes tabs + slash destination
// surfaced prominently + contract actions.
for (const action of ["'Add stake'", "'View contract'"]) {
    assert.ok(src.includes(action), `StakeDetail offers ${action}`);
}
for (const tab of ["id: 'positions'", "id: 'slashes'"]) {
    assert.ok(src.includes(tab), `StakeDetail has contract tab ${tab}`);
}
assert.ok(/Penalty destination/.test(src),
    'StakeDetail surfaces the penalty (slash) destination');
// Holder-facing copy names a contract slash a penalty; ids and fields keep "slash".
assert.ok(!/label: 'Slashes'|No slash events|Slash events|slashable|>Slash destination</.test(src),
    'StakeDetail user-facing copy says penalty, not slash');
assert.ok(/cooldown_end_block/.test(src),
    'StakeDetail shows cooldown release blocks');

// 5. Handlers-absent actions render as disabled rows with a reason (house pattern).
assert.ok(/reason: typeof onSelect !== 'function' \? NOT_WIRED/.test(src)
    && /reason: typeof handler !== 'function' \? NOT_WIRED/.test(src),
    'StakeDetail locks an action whose handler is absent, in both variants');
assert.ok(/disabled=\{Boolean\(tile\.reason\)\}/.test(src) && /disabledReason=\{tile\.reason \?/.test(src),
    'a locked action is a disabled row that shows its reason');
for (const prop of ['onClaimRewards', 'onUnstake', 'onDelegate', 'onStakeMore', 'onRevokeDelegation', 'onOpenContract']) {
    assert.ok(src.includes(prop), `StakeDetail threads ${prop} into an action`);
}

// 5b. Every shell wires the validator Add stake / Stake again actions to the
// network stake form (StakingForm, action stake) with the stake's address.
import { readFileSync as readShell } from 'node:fs';
for (const shellPath of ['packages/web/src/App.jsx', 'packages/desktop/renderer/App.jsx', 'packages/extension/src/popup/App.jsx']) {
    const shellSrc = readShell(new URL(`../../../${shellPath}`, import.meta.url), 'utf8');
    assert.ok(/: \(\) => setUnlockedView\('stake-form'\)\}\s*onOpenContract=/.test(shellSrc),
        `${shellPath} wires validator onStakeMore to the stake form`);
    assert.ok(/action="stake"\s*initialFromAddress=\{stakingRef\.address \|\| undefined\}/.test(shellSrc),
        `${shellPath} opens StakingForm with action stake and the stake's address`);
}

// 6. Data wiring: narrow per-position queries, silent contract-lane
// degrade, demo path.
for (const call of [
    'messaging.getStakesForAddress',
    'messaging.getDelegationsForAddress',
    'messaging.getRewardsForAddress',
    'messaging.getContractByActionIndex',
    'messaging.getContractStakesForAddress',
    'messaging.getContractUnstakesForAddress',
    'messaging.getSlashEventsForAddress',
]) {
    assert.ok(src.includes(call), `StakeDetail calls ${call}`);
}
assert.ok(/getContractStakesForAddress\([\s\S]{0,80}?\)\.catch\(\(\)\s*=>\s*\[\]\)/.test(src),
    'StakeDetail silently degrades contract-stake queries');
for (const call of ['isDemoWallet', 'synthesizeDemoStaking', 'synthesizeDemoContractStakes']) {
    assert.ok(src.includes(call), `StakeDetail uses ${call}`);
}

// 7. 3-shell App.jsx wiring: stake-detail view fed by stakingRef,
// validator actions to the existing forms, contract actions through
// contractRef with initialMode, forms' onBack popping the shell's history
// so they return to the detail page they were opened from.
for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('StakeDetail'), `${shell} App.jsx imports StakeDetail`);
    assert.ok(app.includes("'stake-detail'"), `${shell} tracks the stake-detail view`);
    assert.ok(/unlockedView === 'stake-detail' && activeWalletId && stakingRef/.test(app),
        `${shell} guards stake-detail on stakingRef`);
    // One renderStakeDetail(ref) draws the page and Staking's wide right
    // panel; the page's ref is stakingRef.
    assert.ok(/renderStakeDetail = \(ref[^)]*\) => \([\s\S]{0,200}kind=\{ref\.kind\}/.test(app)
        && /renderStakePage=[\s\S]{0,200}renderStakeDetail\(ref/.test(app),
        `${shell} passes the stake's kind through`);
    assert.ok(/onRevokeDelegation=\{\(\)\s*=>\s*setUnlockedView\('staking-revoke'\)\}/.test(app),
        `${shell} wires StakeDetail.onRevokeDelegation → staking-revoke`);
    assert.ok(/onClaimRewards=\{\(\)\s*=>\s*setUnlockedView\('staking-claim'\)\}/.test(app),
        `${shell} wires StakeDetail.onClaimRewards → staking-claim`);
    assert.ok(!/OperatorDashboard|'operator-dashboard'/.test(app),
        `${shell} has no Operator Dashboard route`);
    assert.ok(/initialMode:\s*'unstake'/.test(app),
        `${shell} preselects unstake mode for contract-position Unstake`);
    // The write forms launched from the detail page return to it by Back,
    // never by naming a page that may not be where the user came from.
    for (const view of ['staking-unstake', 'staking-claim', 'staking-delegate', 'staking-revoke']) {
        const block = app.split(`unlockedView === '${view}'`)[1]?.split('unlockedView ===')[0] || '';
        assert.ok(/onBack=\{goBack\}/.test(block) && !block.includes('setUnlockedView('),
            `${shell} returns from ${view} to the page it was opened from`);
    }
}

console.log(
    'OK: stake detail smoke (StakeDetail chart hero/bubbles/icon tabs/action list + validator & contract variants + locked-when-absent + silent contract-lane degrade + 3-shell wiring with detail-returning back-nav)',
);
