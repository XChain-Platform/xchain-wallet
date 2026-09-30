// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { composeForConfirm } from '../../../packages/core/src/flows/composeForConfirm.js';
import { useConfirmAction } from '../../../packages/core/src/shared/hooks/useConfirmAction.js';

const RESERVATION_ID = '0123456789abcdef0123456789abcdef';
const COMPOSED = {
    actionString: 'SEND|0|JDOG|1|addr',
    psbt: 'PSBT',
    encoding: 'OP_RETURN',
    expectedOutputs: { addressed: [], encoding: 'OP_RETURN', encoderReservationId: RESERVATION_ID },
    tamperVerified: true,
};

afterEach(() => cleanup());

function settle(promise) {
    return promise.then((value) => ({ value }), (error) => ({ error }));
}

async function readyConfirm(result, { client, compose = async () => COMPOSED } = {}) {
    let confirmation;
    await act(async () => {
        confirmation = settle(result.current.confirm({
            compose,
            onApprove: async () => ({ txid: 'tx1' }),
            chainId: 'btc',
            encoderClient: client,
        }));
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    return { confirmation };
}

describe('useConfirmAction encoder reservation release', () => {
    it('keeps the reservation id returned by create_tx on the composed result', async () => {
        const encoder = {
            createTx: vi.fn(async () => ({
                psbt: 'PSBT',
                encoding: 'OP_RETURN',
                reservation: { id: RESERVATION_ID },
            })),
        };
        const composed = await composeForConfirm({
            sdkRegistry: {
                get: () => ({
                    encoder,
                    actions: {
                        createAction: () => ({
                            actionString: 'SEND|0|JDOG|1|addr',
                            action: 'SEND',
                            version: 0,
                        }),
                    },
                }),
            },
            chainRegistry: {
                get: () => ({ coin: 'BTC', networkKind: 'regtest', adsDonationAddress: 'donate' }),
            },
            vault: {
                settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) },
            },
            chainId: 'btc',
            actionData: {
                action: 'SEND',
                params: { TICK: 'JDOG', AMOUNT: '1', DESTINATION: 'addr' },
            },
            encoderOpts: { pubkey: 'pub', change: 'change' },
            source: 'change',
        });

        expect(composed.expectedOutputs.encoderReservationId).toBe(RESERVATION_ID);
    });

    it('releases once on reject', async () => {
        const client = { releaseInputs: vi.fn(async () => ({ released: true })) };
        const { result, unmount } = renderHook(() => useConfirmAction());
        const { confirmation } = await readyConfirm(result, { client });

        await act(async () => {
            result.current.reject();
            await confirmation;
        });
        unmount();

        expect(client.releaseInputs).toHaveBeenCalledOnce();
        expect(client.releaseInputs).toHaveBeenCalledWith(RESERVATION_ID);
    });

    it('releases once when an open confirmation is aborted by unmount', async () => {
        const client = { releaseInputs: vi.fn(async () => ({ released: true })) };
        const hook = renderHook(() => useConfirmAction());
        await readyConfirm(hook.result, { client });

        hook.unmount();

        expect(client.releaseInputs).toHaveBeenCalledOnce();
        expect(client.releaseInputs).toHaveBeenCalledWith(RESERVATION_ID);
    });

    it('releases a reservation returned after reject aborted an in-flight compose', async () => {
        const client = { releaseInputs: vi.fn(async () => ({ released: true })) };
        let finishCompose;
        const compose = () => new Promise((resolve) => { finishCompose = resolve; });
        const { result } = renderHook(() => useConfirmAction());
        let confirmation;
        await act(async () => {
            confirmation = settle(result.current.confirm({
                compose,
                onApprove: async () => ({ txid: 'tx1' }),
                chainId: 'btc',
                encoderClient: client,
            }));
        });

        await act(async () => { result.current.reject(); });
        await act(async () => {
            finishCompose(COMPOSED);
            await confirmation;
        });

        expect(client.releaseInputs).toHaveBeenCalledOnce();
        expect(client.releaseInputs).toHaveBeenCalledWith(RESERVATION_ID);
    });

    it('never releases on approve', async () => {
        const client = { releaseInputs: vi.fn(async () => ({ released: true })) };
        const { result } = renderHook(() => useConfirmAction());
        const { confirmation } = await readyConfirm(result, { client });

        await act(async () => {
            await result.current.approve({});
            await confirmation;
        });

        expect(client.releaseInputs).not.toHaveBeenCalled();
    });

    it('never releases after a broadcast failure', async () => {
        const client = { releaseInputs: vi.fn(async () => ({ released: true })) };
        const broadcastError = Object.assign(new Error('missing inputs'), {
            name: 'BroadcastFailedPermanentError',
        });
        const { result } = renderHook(() => useConfirmAction());
        let confirmation;
        await act(async () => {
            confirmation = settle(result.current.confirm({
                compose: async () => COMPOSED,
                onApprove: async () => { throw broadcastError; },
                chainId: 'btc',
                encoderClient: client,
            }));
        });
        await waitFor(() => expect(result.current.phase).toBe('ready'));

        await act(async () => {
            await result.current.approve({});
            await confirmation;
        });

        expect(client.releaseInputs).not.toHaveBeenCalled();
    });

    it('does nothing when the pinned client lacks releaseInputs', async () => {
        const client = {};
        const { result } = renderHook(() => useConfirmAction());
        const { confirmation } = await readyConfirm(result, { client });

        await act(async () => {
            result.current.reject();
            await confirmation;
        });

        expect(client).not.toHaveProperty('releaseInputs');
    });

    it('swallows synchronous and asynchronous release errors', async () => {
        for (const releaseInputs of [
            vi.fn(() => { throw new Error('sync failure'); }),
            vi.fn(async () => { throw new Error('async failure'); }),
        ]) {
            const { result } = renderHook(() => useConfirmAction());
            const { confirmation } = await readyConfirm(result, { client: { releaseInputs } });
            await act(async () => {
                result.current.reject();
                await confirmation;
            });
            expect(releaseInputs).toHaveBeenCalledOnce();
            cleanup();
        }
    });
});
