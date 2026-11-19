// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Broadcast form no longer owns raw transaction submission, so opening it
// cannot create the auto-lock hold used by the signed-transaction relay.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React, { useState } from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { useAutoLockPolicy } from '../../../packages/core/src/shared/hooks/useAutoLockPolicy.js';
import { isAutoLockHeld } from '../../../packages/core/src/shared/hooks/autoLockGuard.js';
import { BroadcastForm } from '../../../packages/core/src/shared/routes/BroadcastForm.jsx';

const ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';

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

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('BroadcastForm and raw broadcast auto-lock', () => {
    it('does not expose the removed raw transaction request path', async () => {
        const broadcastSignedTxRequest = vi.fn();
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
        await screen.findByLabelText('Message');

        expect(screen.queryByLabelText('Signed transaction')).toBeNull();
        expect(screen.queryByLabelText('Signed transaction code')).toBeNull();
        expect(isAutoLockHeld()).toBe(false);
        expect(broadcastSignedTxRequest).not.toHaveBeenCalled();
    });
});
