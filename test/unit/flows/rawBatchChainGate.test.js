// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The per-chain action gate holds in every lane that can encode an action: a
// BATCH whose COMMAND is typed raw is checked leg by leg in the signing lane,
// and the watch-only lane (unsigned PSBT) applies the same gate before any
// encoding, so neither produces a transaction the indexer records as invalid.

import { describe, it, expect, vi } from 'vitest';
import { advancedAction } from '../../../packages/core/src/flows/advancedAction.js';
import { buildActionPsbt } from '../../../packages/core/src/flows/buildActionPsbt.js';

const chainRegistry = {
    get: (id) => ({ coin: id.split('-')[0], networkKind: id.split('-')[1] }),
};
const FROM = { address: 'addr', publicKey: '02'.padEnd(66, '1'), addressId: 'a1' };

function makeSdk(version = 0) {
    return {
        actions: {
            composeActionString: vi.fn(({ action }) => ({ action, version })),
            createAction: vi.fn(() => { throw new Error('reached createAction'); }),
        },
        encoder: { createTx: vi.fn() },
    };
}

function signingRun({ chainId, action, params, sdk = makeSdk() }) {
    return {
        sdk,
        run: advancedAction({
            chainRegistry, sdkRegistry: { get: () => sdk }, chainId, from: FROM, action, params,
        }),
    };
}

function watcherRun({ chainId, action, params, sdk = makeSdk() }) {
    return {
        sdk,
        run: buildActionPsbt({
            chainRegistry, sdkRegistry: { get: () => sdk }, chainId, from: FROM, actionData: { action, params },
        }),
    };
}

const batch = (command) => ({ action: 'BATCH', params: { VERSION: '0', COMMAND: command } });
const GATED_LEGS = [
    ['COLLECT v0', 'COLLECT|0|x'],
    ['STAKE v1', 'STAKE|1|x'],
    ['STAKE v2', 'STAKE|2|x'],
    ['UNSTAKE v0', 'UNSTAKE|0|x'],
    ['DELEGATE v0', 'DELEGATE|0|x'],
    ['DELEGATE v2', 'DELEGATE|2|x'],
    ['XBRIDGE v0', 'XBRIDGE|0|x'],
];

describe('raw BATCH in the signing lane', () => {
    for (const [label, leg] of GATED_LEGS) {
        it(`refuses a nested ${label} on Litecoin before anything is signed`, async () => {
            const { run, sdk } = signingRun({ chainId: 'litecoin-regtest', ...batch(`SEND|0|a|1|;${leg}`) });
            await expect(run).rejects.toThrow(/^advancedAction: .* accepted on Bitcoin only, not on litecoin-regtest$/);
            expect(sdk.actions.composeActionString).not.toHaveBeenCalled();
            expect(sdk.actions.createAction).not.toHaveBeenCalled();
        });

        it(`lets a nested ${label} past the gate on Bitcoin`, async () => {
            const { run } = signingRun({ chainId: 'bitcoin-regtest', ...batch(`SEND|0|a|1|;${leg}`) });
            await expect(run).rejects.not.toThrow(/accepted on Bitcoin only/);
        });
    }

    it('refuses a nested XBRIDGE v1 on Bitcoin', async () => {
        const { run } = signingRun({ chainId: 'bitcoin-regtest', ...batch('XBRIDGE|1|x') });
        await expect(run).rejects.toThrow('advancedAction: XBRIDGE version 1 is not accepted on Bitcoin');
    });

    it('refuses a gated leg whose version cannot be read', async () => {
        const { run } = signingRun({ chainId: 'bitcoin-regtest', ...batch('STAKE||x') });
        await expect(run).rejects.toThrow('advancedAction: STAKE version is unreadable in a nested sub-action');
    });

    it('reads a leg spelled in lower case or behind a pasted BATCH prefix', async () => {
        for (const command of ['stake|1|x', 'BATCH|0|STAKE|1|x', ' "STAKE" | 1 |x']) {
            const { run } = signingRun({ chainId: 'litecoin-regtest', ...batch(command) });
            await expect(run).rejects.toThrow(/accepted on Bitcoin only, not on litecoin-regtest/);
        }
    });

    it('reads a string param under any key as a COMMAND', async () => {
        const { run } = signingRun({
            chainId: 'litecoin-regtest', action: 'BATCH', params: { command: 'SEND|0|a|1|;COLLECT|0|x' },
        });
        await expect(run).rejects.toThrow(/COLLECT version 0 is accepted on Bitcoin only/);
    });

    it('leaves ungated legs alone on Litecoin', async () => {
        const { run } = signingRun({ chainId: 'litecoin-regtest', ...batch('SEND|0|a|1|;MINT|1|P|5|') });
        await expect(run).rejects.not.toThrow(/accepted on Bitcoin only|unreadable/);
    });
});

describe('the watch-only lane', () => {
    const REFUSED = [
        ['STAKE v1', 'STAKE', 1],
        ['STAKE v2', 'STAKE', 2],
        ['UNSTAKE v0', 'UNSTAKE', 0],
        ['DELEGATE v0', 'DELEGATE', 0],
        ['DELEGATE v2', 'DELEGATE', 2],
    ];
    for (const chainId of ['litecoin-regtest', 'dogecoin-regtest']) {
        for (const [label, action, version] of REFUSED) {
            it(`refuses ${label} on ${chainId} before the action is encoded`, async () => {
                const { run, sdk } = watcherRun({ chainId, action, params: { AMOUNT: '1' }, sdk: makeSdk(version) });
                await expect(run).rejects.toThrow(
                    `buildActionPsbt: ${action} version ${version} is accepted on Bitcoin only, not on ${chainId}`,
                );
                expect(sdk.actions.composeActionString)
                    .toHaveBeenCalledWith({ action, params: { AMOUNT: '1' } }, { validate: false });
                expect(sdk.actions.createAction).not.toHaveBeenCalled();
                expect(sdk.encoder.createTx).not.toHaveBeenCalled();
            });
        }
    }

    it('lets STAKE v3 on Litecoin and STAKE v1 on Bitcoin through to the encoder', async () => {
        for (const [chainId, version] of [['litecoin-regtest', 3], ['bitcoin-regtest', 1]]) {
            const { run } = watcherRun({ chainId, action: 'STAKE', params: { AMOUNT: '1' }, sdk: makeSdk(version) });
            await expect(run).rejects.toThrow('reached createAction');
        }
    });

    it('gates a lower-case action name the same way', async () => {
        const { run } = watcherRun({ chainId: 'litecoin-regtest', action: 'stake', params: {}, sdk: makeSdk(1) });
        await expect(run).rejects.toThrow(/accepted on Bitcoin only/);
    });

    it('never composes an ungated action', async () => {
        const { run, sdk } = watcherRun({ chainId: 'litecoin-regtest', action: 'SEND', params: {} });
        await expect(run).rejects.toThrow('reached createAction');
        expect(sdk.actions.composeActionString).not.toHaveBeenCalled();
    });

    it('refuses a raw BATCH carrying a gated leg off Bitcoin and not on it', async () => {
        const off = watcherRun({ chainId: 'dogecoin-regtest', ...batch('SEND|0|a|1|;COLLECT|0|x') });
        await expect(off.run).rejects.toThrow(/^buildActionPsbt: COLLECT version 0 is accepted on Bitcoin only/);
        expect(off.sdk.actions.createAction).not.toHaveBeenCalled();
        const on = watcherRun({ chainId: 'bitcoin-regtest', ...batch('SEND|0|a|1|;COLLECT|0|x') });
        await expect(on.run).rejects.toThrow('reached createAction');
    });
});
