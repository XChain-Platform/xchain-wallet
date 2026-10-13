// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act as domAct, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MultisigSigningSession } from '../../../packages/core/src/shared/routes/MultisigSigningSession.jsx';
import { createMultisigSigningSession } from '../../../packages/core/src/schemas/multisigSigningSession.js';

const session = createMultisigSigningSession({
    walletId: 'wallet-1',
    chainId: 'bitcoin-mainnet',
    scheme: 'p2wsh-multisig',
    threshold: 2,
    cosignerPubkeys: ['02' + 'a'.repeat(64), '03' + 'b'.repeat(64)],
    msgHash: 'c'.repeat(64),
    psbtHex: '70736274ff',
    actionSummary: 'Send 1 BTC',
});

async function drain(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

describe('MultisigSigningSession in watcher mode', () => {
    it('keeps export available but never offers a local password-signing route', async () => {
        const messaging = {
            getSettings: vi.fn(async () => ({ walletMode: 'watcher' })),
            listMultisigSigningSessions: vi.fn(async () => [session]),
            getMultisigSigningSession: vi.fn(async () => session),
            signMultisigLocally: vi.fn(),
        };
        let utils;
        await domAct(async () => {
            utils = render(
                <MessagingProvider shell="web" messaging={messaging}>
                    <MultisigSigningSession walletId="wallet-1" onBack={() => {}} />
                </MessagingProvider>,
            );
            await drain();
        });

        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: /Send 1 BTC/i }));
            await drain();
        });

        expect(utils.getByRole('button', { name: /Export transaction QR/i })).toBeTruthy();
        expect(utils.queryByRole('button', { name: /Sign with my key/i })).toBeNull();
        expect(utils.queryByLabelText(/Wallet password/i)).toBeNull();
        expect(utils.container.textContent).toContain('Watcher mode exports signing data');
        expect(messaging.signMultisigLocally).not.toHaveBeenCalled();
    });
});
