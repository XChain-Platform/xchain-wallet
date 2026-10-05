// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { composeActionForConfirm } from '../../../packages/core/src/flows/composeActionForConfirm.js';
import { UserRejectedError, useConfirmAction } from '../../../packages/core/src/shared/hooks/useConfirmAction.js';

afterEach(() => cleanup());

function makeEncoder() {
    let reserved = false;
    const createTx = vi.fn(async () => {
        if (reserved) throw new Error('inputs are reserved');
        reserved = true;
        return { psbt: 'PSBTHEX', encoding: 'OP_RETURN', reservation: { id: 'input-1' } };
    });
    const releaseInputs = vi.fn(async (id) => {
        if (id !== 'input-1') throw new Error('unknown reservation');
        reserved = false;
    });
    return { createTx, releaseInputs };
}

function makeHarness() {
    const encoder = makeEncoder();
    const sdk = {
        encoder,
        actions: { createAction: () => ({ actionString: 'SEND|0|JDOG|1|addr', action: 'SEND', version: 0 }) },
        wallet: { decomposePsbt: () => ({ outputs: [{ address: 'source', value: 100 }] }) },
        decoder: {
            decodeActionStringFromPsbt: () => ({ ok: true, actionString: 'SEND|0|JDOG|1|addr' }),
            parse: () => ({ ok: false }),
        },
    };
    return {
        sdk,
        vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
        sdkRegistry: { get: () => sdk },
        chainRegistry: { get: () => ({ coin: 'BTC', networkKind: 'regtest' }) },
    };
}

function composeArgs(harness) {
    return {
        vault: harness.vault,
        sdkRegistry: harness.sdkRegistry,
        chainRegistry: harness.chainRegistry,
        chainId: 'btc',
        actionData: { action: 'SEND', params: { TICK: 'JDOG', AMOUNT: '1', DESTINATION: 'addr' } },
        encoderOpts: { pubkey: 'pub' },
        source: 'source',
    };
}

describe('rejecting a composed action', () => {
    it('releases encoder inputs so a following cancel can reserve them', async () => {
        const harness = makeHarness();
        const { result } = renderHook(() => useConfirmAction());
        const compose = () => composeActionForConfirm(composeArgs(harness));
        let confirmation;
        await act(async () => {
            confirmation = result.current.confirm({ compose, onApprove: vi.fn(), chainId: 'btc' })
                .then((value) => ({ value }), (error) => ({ error }));
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        await expect(harness.sdk.encoder.createTx({ action: 'CANCEL' })).rejects.toThrow('inputs are reserved');
        await act(async () => { await result.current.reject(); });
        expect((await confirmation).error).toBeInstanceOf(UserRejectedError);
        await expect(harness.sdk.encoder.createTx({ action: 'CANCEL' })).resolves.toMatchObject({ psbt: 'PSBTHEX' });
        expect(harness.sdk.encoder.releaseInputs).toHaveBeenCalledWith('input-1');
    });
});
