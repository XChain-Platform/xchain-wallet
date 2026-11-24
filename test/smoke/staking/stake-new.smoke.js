// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the new-stake chooser behind the staking list's "+":
// StakeNew forks between validator staking (→ the Staking form on the
// network, with an inline network step when >1 BTC chain has addresses) and
// contract staking (→ contract browser → "Stake here" → the Staking form on
// that contract).

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

const newPath = join(sharedRoutes, 'StakeNew.jsx');
assert.ok(existsSync(newPath), 'StakeNew.jsx exists');
const src = readFileSync(newPath, 'utf8');

// 1. Component export + the two option cards.
assert.ok(/export function StakeNew\b/.test(src), 'StakeNew is a named export');
assert.ok(/t\('stakeNew\.validatorTitle'\)/.test(src), 'StakeNew offers the validator arm');
assert.ok(/t\('stakeNew\.contractTitle'\)/.test(src), 'StakeNew offers the contract arm');
assert.ok(/onPickValidator/.test(src) && /onPickContract/.test(src),
    'StakeNew exposes both arm callbacks');

// 2. BTC-only gate + inline chain step when several BTC chains qualify.
assert.ok(/chainRegistry\.byCoin\(VALIDATOR_LANE_COIN\)/.test(src),
    'StakeNew gates the validator arm on the validator lane coin');
assert.ok(/disabled=\{!canStakeContract\}/.test(src) && !/STAKING_COIN/.test(src),
    'StakeNew gates the contract arm on a held chain that advertises STAKE, not on Bitcoin');
assert.ok(/t\('stakeNew\.bitcoinOnly'\)/.test(src),
    'StakeNew explains the BTC-only gate when no address qualifies');
assert.ok(/stakingChains\.length === 1\s*\)\s*onPickValidator\(stakingChains\[0\]\)/.test(src),
    'StakeNew skips the chain step when exactly one BTC chain qualifies');
assert.ok(/setStep\('chain'\)/.test(src),
    'StakeNew shows the inline chain step otherwise');

// 3. The Staking form preselects the action the contract arm's detail-page
// quick actions rely on: the shells pass the position's initialMode as
// `action`, and the form opens on it (Stake by default).
const sf = readFileSync(join(sharedRoutes, 'StakingForm.jsx'), 'utf8');
assert.ok(/useState\([\s\S]{0,160}?openedAction \|\| 'stake'/.test(sf),
    'StakingForm opens on the action it is given, Stake by default');

// 4. 3-shell App.jsx wiring: "+" → stake-new; validator arm seeds
// stakingRef and opens stake-form; contract arm flags the picker and
// opens the contract browser, whose back button returns to the chooser
// and whose "Stake here" form returns to the staking root.
for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('StakeNew'), `${shell} App.jsx imports StakeNew`);
    assert.ok(app.includes("'stake-new'"), `${shell} tracks the stake-new view`);
    assert.ok(/onPickValidator=\{\(chainId\)\s*=>\s*\{\s*setStakingRef\(\{ kind: 'validator', chainId, address: '' \}\);\s*setUnlockedView\('stake-form'\)/.test(app),
        `${shell} wires StakeNew.onPickValidator → stake-form with a validator ref`);
    assert.ok(/onPickContract=\{\(\) => setUnlockedView\('contracts-list'\)\}/.test(app),
        `${shell} wires StakeNew.onPickContract → contracts-list`);
    // Back from the contract browser and the stake form pops the shell's
    // history, so it reaches the chooser or the detail page it came from
    // without a per-origin branch.
    assert.ok(!/stakeContractPickerActive|origin === 'stake-(picker|detail)'/.test(app),
        `${shell} keeps no per-origin back-nav for contract staking`);
    const stakeBlock = app.split("unlockedView === 'contract-stake'")[1]?.split('unlockedView ===')[0] || '';
    assert.ok(/onBack=\{goBack\}/.test(stakeBlock),
        `${shell} contract-stake Back returns to the page it was opened from`);
    assert.ok(/<StakingForm\b[\s\S]*kind: 'contract'[\s\S]*action=\{contractRef\.initialMode \|\| 'stake'\}/.test(stakeBlock),
        `${shell} contract-stake opens the Staking form on the contract with the preselected action`);
}

console.log(
    'OK: stake new smoke (StakeNew two-arm chooser + BTC gate + inline chain step + StakingForm action preselect + 3-shell wiring with history Back)',
);
