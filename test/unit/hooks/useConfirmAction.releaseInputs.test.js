// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { composeForConfirm } from '../../../packages/core/src/flows/composeForConfirm.js';
import { refusedBeforeSigning, useConfirmAction } from '../../../packages/core/src/shared/hooks/useConfirmAction.js';

const RESERVATION_ID = '0123456789abcdef0123456789abcdef';

afterEach(() => cleanup());

function settle(promise) {
    return promise.then((value) => ({ value }), (error) => ({ error }));
}

function makeCompose({ releaseInputs, reservationId = RESERVATION_ID, action = 'SEND' } = {}) {
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
                        actionString: `${action}|0|JDOG|1|addr`,
                        action,
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
            action,
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

    // A refusal raised before signing leaves nothing that could spend the
    // inputs, and the fresh review it asks for needs them free to compose.
    it('releases once when onApprove refuses before signing', async () => {
        const releaseInputs = vi.fn(async () => ({ released: true }));
        const { compose } = makeCompose({ releaseInputs });
        const hook = renderHook(() => useConfirmAction());
        const refusal = refusedBeforeSigning(new Error('Terms changed. Nothing was sent.'));
        const { confirmation } = await readyConfirm(hook.result, compose, async () => { throw refusal; });

        await act(async () => {
            await hook.result.current.approve({});
        });
        expect((await confirmation).error).toBe(refusal);
        hook.unmount();

        expect(releaseInputs).toHaveBeenCalledOnce();
        expect(releaseInputs).toHaveBeenCalledWith(RESERVATION_ID);
    });

    it('releases a send build once when broadcast is permanently refused', async () => {
        const releaseInputs = vi.fn(async () => ({ released: true }));
        const { compose } = makeCompose({ releaseInputs });
        const hook = renderHook(() => useConfirmAction());
        const refusal = Object.assign(new Error('Nothing was sent: bad-txns-inputs-missingorspent'), {
            name: 'BroadcastFailedPermanentError',
        });
        const { confirmation } = await readyConfirm(
            hook.result,
            compose,
            async () => { throw refusal; },
        );

        await act(async () => {
            await hook.result.current.approve({});
        });
        expect((await confirmation).error).toBe(refusal);
        hook.unmount();

        expect(releaseInputs).toHaveBeenCalledOnce();
        expect(releaseInputs).toHaveBeenCalledWith(RESERVATION_ID);
    });

    it('releases a staking action build when broadcast is permanently refused', async () => {
        const releaseInputs = vi.fn(async () => ({ released: true }));
        const { compose } = makeCompose({ releaseInputs, action: 'UNSTAKE' });
        const hook = renderHook(() => useConfirmAction());
        const refusal = Object.assign(new Error('Nothing was sent: txn-mempool-conflict'), {
            name: 'BroadcastFailedPermanentError',
        });
        const { confirmation } = await readyConfirm(
            hook.result,
            compose,
            async () => { throw refusal; },
        );

        await act(async () => {
            await hook.result.current.approve({});
        });
        expect((await confirmation).error).toBe(refusal);
        hook.unmount();

        expect(releaseInputs).toHaveBeenCalledOnce();
        expect(releaseInputs).toHaveBeenCalledWith(RESERVATION_ID);
    });

    it.each([
        ['transient refusal', Object.assign(new Error('ECONNREFUSED'), { name: 'BroadcastFailedTransientError' })],
        ['unknown outcome', new Error('signer reply was lost')],
        ['already-known reply', Object.assign(new Error('txn-already-known'), { name: 'BroadcastFailedPermanentError' })],
    ])('keeps inputs held for a %s', async (_label, outcome) => {
        const releaseInputs = vi.fn(async () => ({ released: true }));
        const { compose } = makeCompose({ releaseInputs });
        const hook = renderHook(() => useConfirmAction());
        const { confirmation } = await readyConfirm(
            hook.result,
            compose,
            async () => { throw outcome; },
        );

        await act(async () => {
            await hook.result.current.approve({});
        });
        await confirmation;
        hook.unmount();

        expect(releaseInputs).not.toHaveBeenCalled();
    });

    it('keeps inputs held when the submit result is already queued', async () => {
        const releaseInputs = vi.fn(async () => ({ released: true }));
        const { compose } = makeCompose({ releaseInputs });
        const hook = renderHook(() => useConfirmAction());
        const queued = { queued: true, broadcast: 'queued' };
        const { confirmation } = await readyConfirm(hook.result, compose, async () => queued);

        await act(async () => {
            await hook.result.current.approve({});
        });
        expect((await confirmation).value).toBe(queued);
        hook.unmount();

        expect(releaseInputs).not.toHaveBeenCalled();
    });

    it('preserves the permanent refusal when releasing its inputs fails', async () => {
        const releaseInputs = vi.fn(async () => { throw new Error('release unavailable'); });
        const { compose } = makeCompose({ releaseInputs });
        const hook = renderHook(() => useConfirmAction());
        const refusal = Object.assign(new Error('Nothing was sent: bad-txns-inputs-missingorspent'), {
            name: 'BroadcastFailedPermanentError',
        });
        const { confirmation } = await readyConfirm(
            hook.result,
            compose,
            async () => { throw refusal; },
        );

        await act(async () => {
            await hook.result.current.approve({});
        });
        const shown = await confirmation;
        expect(hook.result.current.error).toBe(refusal);
        hook.unmount();

        expect(releaseInputs).toHaveBeenCalledOnce();
        expect(releaseInputs).toHaveBeenCalledWith(RESERVATION_ID);
        expect(shown.error).toBe(refusal);
    });

    it('keeps the inputs held when onApprove fails without saying nothing was signed', async () => {
        const releaseInputs = vi.fn(async () => ({ released: true }));
        const { compose } = makeCompose({ releaseInputs });
        const hook = renderHook(() => useConfirmAction());
        const { confirmation } = await readyConfirm(hook.result, compose, async () => { throw new Error('signer crashed'); });

        await act(async () => {
            await hook.result.current.approve({});
        });
        expect((await confirmation).error?.message).toBe('signer crashed');
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
