// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-42 (binding polls).
//
// Asserts:
//   1. CreatePollForm has a binding-poll section and threads all six callback
//      fields into BOTH param paths - the sdk.voting builder path AND the
//      watcher-mode wire mirror. A field present in one and missing from the
//      other is the drift class  was about.
//   2. The turnout floor is enforced before a transaction is built, and the
//      submit button is disabled while it fails.
//   3. CALLBACK_DELAY_BLOCKS is emitted ONLY when its flag-day is active on the
//      chain, and the activation is measured against the CHAIN's block time,
//      never the local clock. This is the item's silent-drop guard: before the
//      flag-day the indexer accepts the poll and nulls the delay.
//   4. The activation map matches the indexer's own schedule.
//   5. chainTipBlockTime is exported, host-registered and reachable from all
//      three shells.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const read = (p) => readFileSync(p, 'utf8');

const formPath = join(core, 'src', 'shared', 'routes', 'CreatePollForm.jsx');
assert.ok(existsSync(formPath), 'CreatePollForm.jsx exists');
const formSrc = read(formPath);

// 1: the section exists and both param paths carry every callback field.
assert.ok(
    /Binding poll \(run a contract on the result\)/.test(formSrc),
    'form offers a binding-poll disclosure',
);
for (const [camel, wire] of [
    ['callbackContract', 'CALLBACK_CONTRACT'],
    ['callbackMethod', 'CALLBACK_METHOD'],
    ['callbackParams', 'CALLBACK_PARAMS'],
    ['callbackOn', 'CALLBACK_ON'],
    ['gasEscrow', 'GAS_ESCROW'],
    ['callbackDelayBlocks', 'CALLBACK_DELAY_BLOCKS'],
]) {
    assert.ok(
        new RegExp(`p\\.${camel} =|${camel}: `).test(formSrc),
        `${camel} reaches the sdk.voting builder params`,
    );
    assert.ok(
        new RegExp(`${wire}: pollParams\\.${camel}`).test(formSrc),
        `${wire} reaches the watcher-mode wire params (no drift between the two paths)`,
    );
}

// 2: the turnout floor gates both the review step and the submit button.
assert.ok(
    /if \(bindingErrors\.length > 0\) \{ setFormError\(bindingErrors\[0\]\); return; \}/.test(formSrc),
    'review is refused while the binding-poll rules fail',
);
assert.ok(
    /disabled=\{[\s\S]{0,240}bindingErrors\.length > 0/.test(formSrc),
    'submit stays disabled while the binding-poll rules fail',
);
assert.equal(typeof flows.bindingPollErrors, 'function', 'bindingPollErrors is exported from the flows barrel');
assert.equal(typeof flows.isBindingPoll, 'function', 'isBindingPoll is exported from the flows barrel');
// The floor must hold on BOTH sides of the flag-day: a poll is permanent.
assert.equal(
    flows.bindingPollErrors({ callbackContract: '1', callbackMethod: 'm', callbackOn: 'pass' }).length,
    2,
    'a binding poll with no quorum and no min-voters reports both, regardless of flag-day',
);
assert.deepEqual(
    flows.bindingPollErrors({ callbackContract: '', quorum: '', minVoters: '' }),
    [],
    'an advisory poll is never held to the binding floor',
);

// 3: the timelock field is gated on activation, off the chain's block time.
assert.ok(
    /if \(timelockActive && callbackDelayBlocks\.trim\(\)\) \{/.test(formSrc),
    'the callback delay is emitted only once its flag-day is active',
);
assert.ok(
    /messaging\.getChainTipBlockTime\(\{ chainId \}\)/.test(formSrc),
    'activation is measured against the chain tip block time',
);
assert.ok(
    !/Date\.now\(\)/.test(formSrc),
    'the local clock is never the activation source (the indexer gates on block time)',
);
assert.ok(
    /timelockActive \? \([\s\S]{0,400}Delay before the call runs/.test(formSrc),
    'the delay input itself only renders once the flag-day is active',
);

// 4: the map matches xchain-indexer/src/protocol_changes.js.
const activationsSrc = read(join(core, 'src', 'flows', 'protocolActivations.js'));
assert.ok(
    /'bitcoin-mainnet': 1786060800/.test(activationsSrc)
        && /'bitcoin-regtest': 0/.test(activationsSrc),
    'VOTE flag-days match the indexer schedule (mainnet 2026-08-07, regtest genesis)',
);
assert.ok(
    /VOTE_BINDING_MINIMUMS_TIMES/.test(activationsSrc) && /VOTE_CALLBACK_TIMELOCK_TIMES/.test(activationsSrc),
    'both VOTE flag-days are named separately (they are independent protocol changes)',
);
// PC-29's map must stay all-null: these new entries are a different lane.
assert.ok(
    !/GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS = Object\.freeze\(\{[^}]*: *[0-9]/.test(activationsSrc),
    'the PC-29 height map is still all-null (unchanged by PC-42)',
);

// 5: chainTipBlockTime plumbing.
assert.equal(typeof flows.chainTipBlockTime, 'function', 'chainTipBlockTime is exported from the flows barrel');
assert.ok(
    /host\.register\('chain\.tipBlockTime'/.test(
        read(join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js')),
    ),
    'background host registers chain.tipBlockTime',
);
for (const shell of [
    join(wsRoot, 'packages', 'web', 'src', 'messaging.js'),
    join(wsRoot, 'packages', 'desktop', 'renderer', 'messaging.js'),
    join(wsRoot, 'packages', 'extension', 'src', 'popup', 'messaging.js'),
]) {
    assert.ok(
        /export function getChainTipBlockTime\(/.test(read(shell)),
        `${shell.split('/packages/')[1]}: exposes getChainTipBlockTime`,
    );
}

console.log(
    'OK: binding poll smoke (PC-42: callback fields on both param paths + turnout floor + block-time-gated timelock + chainTipBlockTime wiring)',
);
