// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MessagingInbox } from '../../../packages/core/src/shared/routes/MessagingInbox.jsx';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const CHAIN = 'bitcoin-mainnet';
const OWNER = {
    id: 'owner-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    role: 'receive',
};
const PEER = 'bc1qpeerexampleexampleexampleexamplepeer';

function messaging() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
        listContacts: vi.fn().mockResolvedValue([]),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getMessagingInboxSweep: vi.fn().mockResolvedValue({
            messages: [{
                format: 3,
                chainId: CHAIN,
                from: PEER,
                to: OWNER.address,
                txid: 'thread-message',
                text: 'Hello there',
                timestamp: 1,
            }],
            addresses: [],
            errors: [],
        }),
    };
    return new Proxy(target, {
        get(value, property) {
            if (property in value) return value[property];
            return vi.fn().mockResolvedValue({ rows: [] });
        },
    });
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
});

describe('messaging thread filter accessibility', () => {
    it('has no serious violations closed or open', async () => {
        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging()}>
                <MessagingInbox
                    walletId="wallet-1"
                    activeAccountId="account-1"
                    initialCounterparty={PEER}
                    onCompose={() => {}}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        await screen.findByText('Hello there');
        await expectNoSeriousAxeViolations(container);
        fireEvent.click(screen.getByRole('button', { name: 'Filter messages' }));
        screen.getByRole('dialog', { name: 'Filter messages' });
        await expectNoSeriousAxeViolations(container);
    });
});
