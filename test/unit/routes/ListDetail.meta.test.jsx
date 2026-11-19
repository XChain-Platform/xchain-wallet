// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListDetail } from '../../../packages/core/src/shared/routes/ListDetail.jsx';

const baseDetail = {
    type: '0',
    status: 'valid',
    source: 'owner',
    list: [],
};

function renderList(detail) {
    const messaging = {
        getListByActionIndex: vi.fn().mockResolvedValue({ ...baseDetail, ...detail }),
    };

    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListDetail
                chainId="bitcoin-testnet"
                actionIndex="77"
                onBack={() => {}}
                onFork={() => {}}
            />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListDetail metadata', () => {
    // The identity card carries the name in bold, then the type line and the
    // description muted (G16); the Details card has no Name or Description row.
    it('shows the name, the type line and the description on the identity card', async () => {
        renderList({
            name: 'Treasury recipients',
            description: 'Approved payout addresses',
        });

        const card = within(await screen.findByRole('region', { name: 'List identity' }));
        expect(document.body.textContent).not.toMatch(/regtest|testnet|Not mainnet/i);
        expect(card.getByRole('heading', { name: 'Treasury recipients' })).toBeTruthy();
        expect(card.getByText('Address list · #77')).toBeTruthy();
        expect(card.getByText('Approved payout addresses')).toBeTruthy();
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        const details = within(screen.getByRole('list', { name: 'List details' }));
        expect(details.queryByText('Name')).toBeNull();
        expect(details.queryByText('Description')).toBeNull();
    });

    it('shows a name without a description line', async () => {
        renderList({ name: 'Treasury recipients' });

        const card = await screen.findByRole('region', { name: 'List identity' });
        expect(card.querySelectorAll('p')).toHaveLength(1);
    });

    it.each([
        ['missing', {}],
        ['empty', { name: '' }],
        ['non-string', { name: 42 }],
    ])('names a list with a %s name by its type', async (_case, detail) => {
        renderList(detail);

        const card = within(await screen.findByRole('region', { name: 'List identity' }));
        expect(card.getByRole('heading', { name: 'Address list' })).toBeTruthy();
        expect(card.getByText('#77')).toBeTruthy();
    });

    it('neutralizes a right-to-left override in the rendered name', async () => {
        const rlo = String.fromCharCode(0x202E);
        renderList({ name: `Safe${rlo}name` });

        expect(await screen.findByText('Safe\u2426name')).toBeTruthy();
        expect(screen.queryByText(`Safe${rlo}name`)).toBeNull();
    });
});
