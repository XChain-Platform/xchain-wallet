// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { composeForConfirm } from '../../../packages/core/src/flows/composeForConfirm.js';
import { useConfirmAction } from '../../../packages/core/src/shared/hooks/useConfirmAction.js';

const RESERVATION_ID = '0123456789abcdef0123456789abcdef';

afterEach(() => cleanup());

function settle(promise) {
    return promise.then((value) => ({ value }), (error) => ({ error }));
}

function makeCompose({ releaseInputs, reservationId = RESERVATION_ID } = {}) {
    const encoder = {
        createTx: vi.fn(async () => ({
            psbt: 'PSBT',
            encoding: 'OP_RETURN',
            reservation: reservationId ? { id: reservationId } : undefined,
        })),
    };
    if (releaseInputs) encoder.releaseInputs = releaseInputs;

    const compose = () => composeForConfirm({
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

    return { compose, encoder };
}

async function readyConfirm(result, compose, onApprove = async () => ({ txid: 'tx1' })) {
    const composed = await compose();
    let confirmation;
    await act(async () => {
        confirmation = settle(result.current.confirm({
            compose: async () => composed,
            onApprove,
            chainId: 'btc',
        }));
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    return { confirmation };
}

describe('useConfirmAction encoder reservation release', () => {
    it('releases once on reject with the id returned by create_tx', async () => {
        const releaseInputs = vi.fn(async () => ({ released: true }));
        const { compose } = makeCompose({ releaseInputs });
        const hook = renderHook(() => useConfirmAction());
        const { confirmation } = await readyConfirm(hook.result, compose);

        await act(async () => {
            hook.result.current.reject();
            await confirmation;
        });
        hook.unmount();

        expect(releaseInputs).toHaveBeenCalledOnce();
        expect(releaseInputs).toHaveBeenCalledWith(RESERVATION_ID);
    });

    it('releases once when an open confirmation is aborted by unmount', async () => {
        const releaseInputs = vi.fn(async () => ({ released: true }));
        const { compose } = makeCompose({ releaseInputs });
        const hook = renderHook(() => useConfirmAction());
        await readyConfirm(hook.result, compose);

        hook.unmount();

        expect(releaseInputs).toHaveBeenCalledOnce();
        expect(releaseInputs).toHaveBeenCalledWith(RESERVATION_ID);
    });

    it('never releases on approve', async () => {
        const releaseInputs = vi.fn(async () => ({ released: true }));
        const { compose } = makeCompose({ releaseInputs });
        const hook = renderHook(() => useConfirmAction());
        const { confirmation } = await readyConfirm(hook.result, compose);

        await act(async () => {
            await hook.result.current.approve({});
            await confirmation;
        });
        hook.unmount();

        expect(releaseInputs).not.toHaveBeenCalled();
    });

    it('never releases when unmounted while a broadcast is pending', async () => {
        const releaseInputs = vi.fn(async () => ({ released: true }));
        const { compose } = makeCompose({ releaseInputs });
        const hook = renderHook(() => useConfirmAction());
        let finish;
        const onApprove = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
        await readyConfirm(hook.result, compose, onApprove);

        let approving;
        await act(async () => {
            approving = hook.result.current.approve({});
        });
        await waitFor(() => expect(onApprove).toHaveBeenCalledOnce());

        hook.unmount();
        finish({ txid: 'tx1' });
        await approving;

        expect(releaseInputs).not.toHaveBeenCalled();
    });

    it('does nothing when the encoder lacks releaseInputs', async () => {
        const { compose, encoder } = makeCompose();
        const hook = renderHook(() => useConfirmAction());
        const { confirmation } = await readyConfirm(hook.result, compose);

        await act(async () => {
            hook.result.current.reject();
            await confirmation;
        });

        expect(encoder).not.toHaveProperty('releaseInputs');
    });

    it('does nothing when create_tx returns no reservation id', async () => {
        const releaseInputs = vi.fn(async () => ({ released: true }));
        const { compose } = makeCompose({ releaseInputs, reservationId: null });
        const hook = renderHook(() => useConfirmAction());
        const { confirmation } = await readyConfirm(hook.result, compose);

        await act(async () => {
            hook.result.current.reject();
            await confirmation;
        });

        expect(releaseInputs).not.toHaveBeenCalled();
    });

    it('keeps confirmation open when release fails and retries on Reject', async () => {
        const releaseInputs = vi.fn()
            .mockRejectedValueOnce(new Error('release unavailable'))
            .mockResolvedValueOnce({ released: true });
        const { compose } = makeCompose({ releaseInputs });
        const hook = renderHook(() => useConfirmAction());
        const { confirmation } = await readyConfirm(hook.result, compose);
        let confirmationSettled = false;
        confirmation.finally(() => { confirmationSettled = true; });

        await act(async () => {
            await hook.result.current.reject();
        });

        expect(hook.result.current.phase).toBe('ready');
        expect(hook.result.current.error?.message).toMatch(/release.*try reject again/i);
        expect(releaseInputs).toHaveBeenCalledOnce();
        expect(confirmationSettled).toBe(false);

        await act(async () => {
            await hook.result.current.reject();
        });

        expect(releaseInputs).toHaveBeenCalledTimes(2);
        expect((await confirmation).error).toMatchObject({ reason: 'user-rejected' });
        expect(confirmationSettled).toBe(true);
    });
});
