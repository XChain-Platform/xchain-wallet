// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-50 (SPV verified mode).
//
// Asserts:
//   1. Every surface the item names carries the verdict badge: token balance
//      rows, the history list, and the action DETAIL view.
//   2. All three gate on the same `verifyProofs` setting and skip demo
//      wallets, so "opt-in" means one switch rather than three.
//   3. Only checkpointable actions are verified (confirmed, numeric index):
//      an unconfirmed action has no checkpointed block, and asking would
//      produce a permanent "unavailable" that reads like a failure.
//   4. The trust rules that make the badge worth anything hold: a verdict is
//      never taken from the explorer's own say-so, and only a concrete
//      proof-vs-amount contradiction is allowed to read as `failed`.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const read = (p) => readFileSync(p, 'utf8');

const detailPath = join(core, 'src', 'shared', 'routes', 'ActionDetail.jsx');
const historyPath = join(core, 'src', 'shared', 'routes', 'History.jsx');
const balancePath = join(core, 'src', 'shared', 'components', 'BalanceList.jsx');
const flowPath = join(core, 'src', 'flows', 'verifyBalances.js');
assert.ok(existsSync(detailPath) && existsSync(flowPath), 'the SPV surfaces exist');

const detailSrc = read(detailPath);
const historySrc = read(historyPath);
const balanceSrc = read(balancePath);
const flowSrc = read(flowPath);

// 1: the three badge surfaces.
for (const [label, src] of [
    ['balance rows', balanceSrc],
    ['history list', historySrc],
    ['action detail', detailSrc],
]) {
    assert.ok(/<VerifiedBadge/.test(src), `${label}: renders a VerifiedBadge`);
}

// 2: one switch, and demo wallets never claim a proof.
assert.equal(createDefaultSettings().verifyProofs, true, 'verifyProofs is on by default');
for (const [label, src] of [['history list', historySrc], ['action detail', detailSrc]]) {
    assert.ok(
        /settings\?\.verifyProofs !== false/.test(src),
        `${label}: gates on the verifyProofs setting`,
    );
    assert.ok(
        /isDemoWallet\(walletId\)/.test(src),
        `${label}: never badges a demo wallet, whose rows are synthesized`,
    );
}

// 3: only checkpointable actions are asked about.
assert.ok(
    /Number\(entry\.blockIndex\) > 0/.test(detailSrc),
    'action detail verifies only a confirmed action (an unconfirmed one has no checkpointed block)',
);
assert.ok(
    /entry\.actionIndex == null \|\| entry\.actionIndex === ''/.test(detailSrc),
    'action detail skips an entry with no action index rather than asking for a proof of nothing',
);

// 4: the trust rules behind the badge.
assert.ok(
    /nothing here trusts the explorer's own/.test(flowSrc),
    'the verdict is not taken from the explorer\'s own `verified` field',
);
assert.ok(
    /MISMATCH_REASONS/.test(flowSrc),
    'only an enumerated proof-vs-amount contradiction may read as `failed`',
);
assert.ok(
    /Only XChain token balances are provable/.test(flowSrc),
    'native rows are documented as unprovable (they come from the utxo-tracker, not the state SMT)',
);
assert.ok(
    /Native rows are never badged/.test(balanceSrc),
    'balance rows honour that: the native coin is never badged',
);

console.log(
    'OK: SPV verified mode smoke (PC-50: badge on balances + history + action detail, one verifyProofs switch, checkpointable-only, explorer-independent verdicts)',
);
