// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useConfirmAction } from '../../../packages/core/src/shared/hooks/useConfirmAction.js';
import {
    publishHomeState,
    startWatchHost,
    stopWatchHost,
} from '../../../packages/core/src/watch/watchHost.js';

const COMPOSED = {
    action: 'SEND',
    actionString: 'SEND|0|BTC|0.025|bc1qrecipient',
    psbt: 'psbt',
    decoded: {
        summary: 'Send 0.025 BTC',
        details: [
            { label: 'Amount', value: '0.025' },
            { label: 'Token', value: 'BTC' },
        ],
    },
};

const HOME_STATE = {
    rows: [],
    activeByChain: {},
    inbox: [],
    settings: {
        activeNetwork: 'mainnet',
        watch: { enabled: true, showTotal: false, startIn: 'fiat' },
    },
};

function bridge() {
    return {
        isAvailable: vi.fn(async () => true),
        sendSnapshot: vi.fn(async () => true),
        sendImage: vi.fn(),
        sendDetail: vi.fn(),
        removeWatchData: vi.fn(),
    };
}

async function readyConfirmation() {
    const hook = renderHook(() => useConfirmAction());
    let confirmation;
    act(() => {
        confirmation = hook.result.current.confirm({
            chainId: 'bitcoin-mainnet',
            compose: vi.fn(async () => COMPOSED),
            onApprove: vi.fn(async () => ({ txid: 'ab'.repeat(32) })),
        });
    });
    await waitFor(() => expect(hook.result.current.phase).toBe('ready'));
    return { hook, confirmation };
}

describe('useConfirmAction watch request publication', () => {
    let watchBridge;

    beforeEach(async () => {
        watchBridge = bridge();
        await startWatchHost({
            target: { Capacitor: { isNativePlatform: () => true } },
            bridge: watchBridge,
        });
        publishHomeState(HOME_STATE);
    });

    afterEach(() => {
        cleanup();
        stopWatchHost();
    });

    it('publishes the composed request at ready and withdraws it on done', async () => {
        const { hook, confirmation } = await readyConfirmation();

        await waitFor(() => expect(watchBridge.sendSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({
                request: expect.objectContaining({
                    id: expect.stringMatching(/^[0-9a-f]{32}$/),
                    kind: 'request',
                    sentence: 'Confirm this Send request on your phone.',
                    amountText: '0.025 BTC',
                }),
            }),
        ));

        await act(async () => { await hook.result.current.approve({}); });
        await expect(confirmation).resolves.toEqual({ txid: 'ab'.repeat(32) });
        expect(watchBridge.sendSnapshot).toHaveBeenLastCalledWith(
            expect.not.objectContaining({ request: expect.anything() }),
        );
    });

    it.each(['rejected', 'navigated'])('withdraws the request when the confirmation is %s', async (ending) => {
        const { hook, confirmation } = await readyConfirmation();
        const settled = confirmation.catch((error) => error);
        await waitFor(() => expect(watchBridge.sendSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({ request: expect.anything() }),
        ));

        if (ending === 'rejected') {
            await act(async () => { await hook.result.current.reject(); });
        } else {
            hook.unmount();
        }

        await expect(settled).resolves.toMatchObject({ reason: 'user-rejected' });
        expect(watchBridge.sendSnapshot).toHaveBeenLastCalledWith(
            expect.not.objectContaining({ request: expect.anything() }),
        );
    });

    it('withdraws the request when Home publishes the locked session', async () => {
        const { hook, confirmation } = await readyConfirmation();
        const settled = confirmation.catch((error) => error);
        await waitFor(() => expect(watchBridge.sendSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({ request: expect.anything() }),
        ));

        publishHomeState({ ...HOME_STATE, session: 'locked' });

        expect(watchBridge.sendSnapshot).toHaveBeenLastCalledWith(
            expect.not.objectContaining({ request: expect.anything() }),
        );
        await act(async () => { await hook.result.current.reject(); });
        await settled;
    });
});
