// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §29 Send/Receive, Step 6: rbfReplace flow.

import { strict as assert } from 'node:assert';
import {
    isEntryReplaceable,
    sendRbfRequest,
    replaceFromHistoryEntry,
    RbfNotSupportedError,
    RbfInvalidEntryError,
} from '../../../packages/core/src/flows/rbfReplace.js';

// --- isEntryReplaceable -------------------------------------------------

assert.equal(isEntryReplaceable(null).ok, false);
assert.equal(isEntryReplaceable({}).ok, false);
assert.match(isEntryReplaceable({}).reason, /entry/i);

assert.deepEqual(
    isEntryReplaceable({ blockIndex: 100, action: 'SEND', txHash: 'abc' }),
    { ok: false, reason: 'Already confirmed.' },
);

assert.deepEqual(
    isEntryReplaceable({ blockIndex: 0, action: 'SEND', txHash: '' }),
    { ok: false, reason: 'No transaction hash on this entry.' },
);

assert.match(
    isEntryReplaceable({ blockIndex: 0, action: 'ISSUE', txHash: 'abc' }).reason,
    /not RBF-replaceable/,
);

const ok = isEntryReplaceable({ blockIndex: 0, action: 'SEND', txHash: 'abc' });
assert.equal(ok.ok, true);

// All replaceable kinds
for (const action of ['SEND', 'SWEEP', 'DISPENSE', 'DIVIDEND', 'AIRDROP', 'EXECUTE', 'DEPOSIT', 'WITHDRAW']) {
    assert.equal(
        isEntryReplaceable({ blockIndex: 0, action, txHash: 'abc' }).ok,
        true,
        `${action} is replaceable`,
    );
}

// Case-insensitive action
assert.equal(
    isEntryReplaceable({ blockIndex: 0, action: 'send', txHash: 'abc' }).ok,
    true,
);

// --- sendRbfRequest -----------------------------------------------------

await assert.rejects(
    () => sendRbfRequest({ messaging: {}, request: { chainId: 'btc', originalTxHash: 'abc', strategy: 'speedup' } }),
    RbfNotSupportedError,
    'no replaceTx → RbfNotSupportedError',
);

await assert.rejects(
    () => sendRbfRequest({
        messaging: { replaceTx: async () => ({}) },
        request: null,
    }),
    RbfInvalidEntryError,
);

await assert.rejects(
    () => sendRbfRequest({
        messaging: { replaceTx: async () => ({}) },
        request: { chainId: '', originalTxHash: 'abc', strategy: 'speedup' },
    }),
    /chainId is required/,
);

await assert.rejects(
    () => sendRbfRequest({
        messaging: { replaceTx: async () => ({}) },
        request: { chainId: 'btc', originalTxHash: '', strategy: 'speedup' },
    }),
    /originalTxHash is required/,
);

await assert.rejects(
    () => sendRbfRequest({
        messaging: { replaceTx: async () => ({}) },
        request: { chainId: 'btc', originalTxHash: 'abc', strategy: 'unknown' },
    }),
    /unknown strategy/,
);

let captured = null;
const fakeMessaging = {
    replaceTx: async (req) => {
        captured = req;
        return { replacementTxHash: 'def', broadcastedAt: '2026-04-26T00:00:00Z' };
    },
};
const result = await sendRbfRequest({
    messaging: fakeMessaging,
    request: { chainId: 'btc', originalTxHash: 'abc', strategy: 'speedup' },
});
assert.equal(result.replacementTxHash, 'def');
assert.equal(captured.chainId, 'btc');
assert.equal(captured.strategy, 'speedup');

// --- replaceFromHistoryEntry -------------------------------------------

await assert.rejects(
    () => replaceFromHistoryEntry({
        messaging: fakeMessaging,
        entry: { blockIndex: 100, action: 'SEND', txHash: 'abc' },
        strategy: 'speedup',
    }),
    RbfInvalidEntryError,
);

const goodResult = await replaceFromHistoryEntry({
    messaging: fakeMessaging,
    entry: {
        blockIndex: 0,
        action: 'SEND',
        txHash: 'orig123',
        chainId: 'bitcoin-mainnet',
    },
    strategy: 'cancel',
    walletId: 'w1',
});
assert.equal(goodResult.replacementTxHash, 'def');
assert.equal(captured.originalTxHash, 'orig123');
assert.equal(captured.chainId, 'bitcoin-mainnet');
assert.equal(captured.strategy, 'cancel');
assert.equal(captured.walletId, 'w1');

console.log('rbf-replace smoke OK');
