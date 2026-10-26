// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MessagingInbox } from '../../../packages/core/src/shared/routes/MessagingInbox.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = { id: 'owner-1', address: 'bc1qexampleexampleexampleexampleexampleex', source: 'hd', role: 'receive' };
const SENDER = 'bc1qsenderaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01234a';

afterEach(cleanup);

describe('MessagingInbox sender address', () => {
    it('shows both ends of an unsaved sender so lookalikes with equal heads differ on screen', async () => {
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
            listContacts: vi.fn().mockResolvedValue([]),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
            getMessagingInboxSweep: vi.fn().mockResolvedValue({
                messages: [{ txid: 't1', from: SENDER, to: OWNER.address, timestamp: 100, method: 0, text: 'hi', chainId: CHAIN }],
                addresses: [],
                errors: [],
            }),
        };
        const messaging = new Proxy(target, {
            get: (value, prop) => (prop in value ? value[prop] : vi.fn().mockResolvedValue({ rows: [] })),
        });
        render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(MessagingInbox, { walletId: 'w', activeAccountId: 'a', onCompose() {}, onBack() {} }),
        ));
        const list = await waitFor(() => screen.getByRole('list', { name: 'Conversations' }));
        expect(list.textContent).toContain(`${SENDER.slice(0, 6)}…${SENDER.slice(-6)}`);
        expect(list.textContent).not.toContain(SENDER);
    });
});
