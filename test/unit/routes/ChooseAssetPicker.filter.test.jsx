// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The DEX's Choose Asset page (markets-picker): its title, and the search in
// the title-bar filter really narrowing the list. A build once listed every
// asset whatever was typed.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { documentTitleFor } from '../../../packages/core/src/shared/hooks/useDocumentTitle.js';
import { ROUTE_REGISTRY } from '../../../packages/core/src/shared/routeRegistry.js';
import { userEvent } from '../../helpers/userEvent.js';

vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast: () => {}, dismissToast: () => {}, clearToasts: () => {} }),
}));

const { ReceivePicker } = await import('../../../packages/core/src/shared/routes/ReceivePicker.jsx');

const token = (tick, name, quantity = '5') => ({ tick, quantity, divisibility: 0, displayName: name, name });

function renderChooseAsset() {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({
            'bitcoin-mainnet': [{ address: 'bc1qchooseasset' }],
            'litecoin-mainnet': [{ address: 'ltc1qchooseasset' }],
        }),
        getWalletBalances: vi.fn().mockResolvedValue({
            // XCP and PEPECASH sit on the bitcoin chain but neither their name
            // nor their ticker says Bitcoin, so the Bitcoin search must drop them.
            'bitcoin-mainnet': [{
                address: 'bc1qchooseasset',
                balances: {
                    native: { tick: 'BTC', quantity: '1', divisibility: 8 },
                    tokens: [token('XCP', 'Counterparty'), token('PEPECASH', 'Pepe Cash')],
                },
            }],
            'litecoin-mainnet': [{
                address: 'ltc1qchooseasset',
                balances: { native: { tick: 'LTC', quantity: '1', divisibility: 8 }, tokens: [] },
            }],
        }),
        // Platform discovery finds nothing, so only the wallet's own rows show.
        searchTokens: vi.fn().mockResolvedValue([]),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ReceivePicker walletId="wallet-1" onBack={() => {}} onSelect={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

const rowNames = () => screen.queryAllByRole('button', { name: /^Select / })
    .map((button) => button.getAttribute('aria-label') || button.textContent);

async function search(user, text) {
    fireEvent.click(screen.getByRole('button', { name: 'Filter coins and tokens' }));
    const box = screen.getByRole('searchbox', { name: 'Search coins or tokens' });
    await user.clear(box);
    await user.type(box, text);
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Choose Asset (markets picker)', () => {
    it('is titled Choose Asset on the page and in the window title', async () => {
        renderChooseAsset();
        expect(await screen.findByRole('heading', { name: 'Choose Asset' })).toBeInTheDocument();
        expect(ROUTE_REGISTRY['markets-picker'].component).toBe('ReceivePicker');
        expect(documentTitleFor({ statusState: 'unlocked', unlockedView: 'markets-picker' }))
            .toBe('XChain Wallet - Choose Asset');
    });

    it('lists only the assets whose name matches the typed text', async () => {
        const user = userEvent.setup();
        renderChooseAsset();
        await screen.findByRole('button', { name: /^Select Bitcoin\b/ });
        // Every asset shows before a search.
        expect(rowNames().some((name) => /Counterparty|XCP/.test(name))).toBe(true);
        expect(rowNames().some((name) => /Litecoin/.test(name))).toBe(true);

        await search(user, 'Bitcoin');

        await waitFor(() => {
            const names = rowNames();
            expect(names.length).toBeGreaterThan(0);
            expect(names.every((name) => /Bitcoin/i.test(name))).toBe(true);
        });
        const names = rowNames();
        expect(names.some((name) => /Counterparty|XCP/.test(name))).toBe(false);
        expect(names.some((name) => /Pepe|PEPECASH/.test(name))).toBe(false);
        expect(names.some((name) => /Litecoin/.test(name))).toBe(false);
    });

    it('matches a ticker as well as a name', async () => {
        const user = userEvent.setup();
        renderChooseAsset();
        await screen.findByRole('button', { name: /^Select Bitcoin\b/ });

        await search(user, 'pepecash');

        await waitFor(() => {
            const names = rowNames();
            expect(names).toHaveLength(1);
            expect(names[0]).toMatch(/Pepe|PEPECASH/);
        });
    });
});
