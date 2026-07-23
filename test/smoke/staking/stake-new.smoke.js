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
// StakeNew forks between validator staking (→ StakeForm, with an
// inline network step when >1 BTC chain has addresses) and contract
// staking (→ contract browser → "Stake here" → ContractStakeForm).

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
assert.ok(/Validator staking/.test(src), 'StakeNew offers the validator arm');
assert.ok(/Contract staking/.test(src), 'StakeNew offers the contract arm');
assert.ok(/onPickValidator/.test(src) && /onPickContract/.test(src),
    'StakeNew exposes both arm callbacks');

// 2. BTC-only gate + inline chain step when several BTC chains qualify.
assert.ok(/STAKING_COIN\s*=\s*['"]bitcoin['"]/.test(src),
    'StakeNew pins STAKING_COIN=bitcoin');
assert.ok(/Staking is available on Bitcoin only/.test(src),
    'StakeNew explains the BTC-only gate when no address qualifies');
assert.ok(/stakingChains\.length === 1\s*\)\s*onPickValidator\(stakingChains\[0\]\)/.test(src),
    'StakeNew skips the chain step when exactly one BTC chain qualifies');
assert.ok(/setStep\('chain'\)/.test(src),
    'StakeNew shows the inline chain step otherwise');

// 3. ContractStakeForm accepts the preselect prop the contract arm's
// detail-page quick actions rely on.
const csf = readFileSync(join(sharedRoutes, 'ContractStakeForm.jsx'), 'utf8');
assert.ok(/initialMode/.test(csf) && /useState\([\s\S]{0,120}?initialMode \|\| 'stake'/.test(csf),
    'ContractStakeForm honors the optional initialMode prop');

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
    assert.ok(/onPickContract=\{\(\)\s*=>\s*\{\s*setStakeContractPickerActive\(true\);\s*setUnlockedView\('contracts-list'\)/.test(app),
        `${shell} wires StakeNew.onPickContract → contracts-list with the picker flag`);
    assert.ok(/stakeContractPickerActive\s*\?\s*'stake-picker'\s*:\s*'contracts-browse'/.test(app),
        `${shell} stamps contractRef.origin from the picker flag`);
    assert.ok(/origin === 'stake-picker'/.test(app),
        `${shell} contract-stake back-nav branches on the stake-picker origin`);
    assert.ok(/origin === 'stake-detail'/.test(app),
        `${shell} contract-stake back-nav branches on the stake-detail origin`);
}

console.log(
    'OK: stake new smoke (StakeNew two-arm chooser + BTC gate + inline chain step + ContractStakeForm.initialMode + 3-shell wiring with origin-based back-nav)',
);
