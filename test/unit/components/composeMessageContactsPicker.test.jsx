// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ComposeMessage } from '../../../packages/core/src/shared/routes/ComposeMessage.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = { id: 'a0', address: 'bc1qexampleexampleexampleexampleexampleex', publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: null };
const OLD = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const NEW = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const contact = (address) => ({
    id: 'c1', name: 'Erin', notes: '', avatarSeed: address, schemaVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    entries: [{ chain: 'bitcoin', address, label: '' }],
});

describe('compose address book picker', () => {
    it('lists the contact as it is saved when the picker opens, not as it was when the form mounted', async () => {
        const listContacts = vi.fn()
            .mockResolvedValueOnce([contact(OLD)])
            .mockResolvedValue([contact(NEW)]);
        const target = {
            getAddressesByChain: () => Promise.resolve({ [CHAIN]: [OWNER] }),
            getActiveAddresses: () => Promise.resolve({ [CHAIN]: OWNER }),
            signerReady: () => Promise.resolve({ ready: true }),
            getSettings: () => Promise.resolve({ walletMode: 'full' }),
            getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
            listContacts,
        };
        const messaging = new Proxy(target, {
            get: (t, prop) => (prop in t ? t[prop] : () => Promise.resolve({ rows: [] })),
        });
        let utils;
        await domAct(async () => {
            utils = render(React.createElement(MessagingProvider, { shell: 'web', messaging },
                React.createElement(ComposeMessage, { walletId: 'w', chainId: CHAIN, onBack() {} })));
            for (let i = 0; i < 12; i += 1) await Promise.resolve();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: /address book|contacts/i }));
            for (let i = 0; i < 12; i += 1) await Promise.resolve();
        });
        expect(utils.container.textContent).toContain(NEW);
        expect(utils.container.textContent).not.toContain(OLD);
    });
});
