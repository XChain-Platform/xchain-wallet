// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Auto-lock waits for a raw broadcast that is already on its way to the node.
// Locking under it tears the session down while the request is in flight and
// leaves the host closed before the broadcast record is settled.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { useAutoLockPolicy } from '../../../packages/core/src/shared/hooks/useAutoLockPolicy.js';
import { isAutoLockHeld } from '../../../packages/core/src/shared/hooks/autoLockGuard.js';
import { BroadcastForm } from '../../../packages/core/src/shared/routes/BroadcastForm.jsx';

const MINUTE = 60 * 1000;
const ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';
const LEGACY_TX = '0200000001aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa03000000474830450221001111111111111111111111111111111111111111111111111111111111110121023333333333333333333333333333333333333333333333333333333333333333fdffffff0240e20100000000001976a914444444444444444444444444444444444444444488ac00000000000000001c6a1a58434841494eabababababababababababababababababababab00000000';

function Shell({ children }) {
    const [state, setState] = useState('unlocked');
    useAutoLockPolicy({ sessionState: state, activeWalletId: 'w', onLocked: () => setState('locked') });
    return state === 'locked' ? <div>Locked screen</div> : children;
}

function makeMessaging(broadcastSignedTxRequest) {
    const target = {
        lockWallet: vi.fn(async () => ({ locked: true })),
        getSettings: vi.fn().mockResolvedValue({ schemaVersion: 2, walletMode: 'full', autolockMinutes: 1 }),
        getAddressesByChain: vi.fn().mockResolvedValue({
            'bitcoin-mainnet': [{ id: 'a1', address: ADDRESS, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' }],
        }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        broadcastSignedTxRequest,
    };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
}

// A laptop lid closed past the timeout: both clocks jump, then the page
// becomes visible again and the hook checks the deadline at once.
async function sleepAndWake(ms) {
    const wall = Date.now() + ms;
    const mono = performance.now() + ms;
    vi.spyOn(Date, 'now').mockReturnValue(wall);
    vi.spyOn(performance, 'now').mockReturnValue(mono);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('raw broadcast and auto-lock', () => {
    it('defers auto-lock while a pasted transaction is broadcasting', async () => {
        let finish;
        const broadcastSignedTxRequest = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
        const messaging = makeMessaging(broadcastSignedTxRequest);
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ToastHost>
                    <Shell>
                        <BroadcastForm walletId="w" initialChainId="bitcoin-mainnet" onBack={() => {}} />
                    </Shell>
                </ToastHost>
            </MessagingProvider>,
        );
        fireEvent.click(await screen.findByRole('radio', { name: 'Signed transaction' }));
        fireEvent.change(screen.getByLabelText('Signed transaction hex'), { target: { value: LEGACY_TX } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview transaction' }));
        await screen.findByText(/spends 1 input/);
        fireEvent.click(screen.getByRole('button', { name: 'Broadcast transaction' }));
        await waitFor(() => expect(broadcastSignedTxRequest).toHaveBeenCalledTimes(1));
        expect(isAutoLockHeld()).toBe(true);

        await sleepAndWake(2 * MINUTE);
        expect(messaging.lockWallet).not.toHaveBeenCalled();
        expect(screen.queryByText('Locked screen')).toBeNull();

        // The deadline already passed, so the lock follows as soon as the
        // broadcast settles, with the host still open to record its outcome.
        await act(async () => { finish({ txid: 'deadbeef' }); });
        expect(isAutoLockHeld()).toBe(false);
        await waitFor(() => expect(messaging.lockWallet).toHaveBeenCalledTimes(1));
        expect(broadcastSignedTxRequest).toHaveBeenCalledTimes(1);
    });
});
