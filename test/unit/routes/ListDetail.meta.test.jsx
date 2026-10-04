// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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
    it('shows name and description in order directly after the list index', async () => {
        const { container } = renderList({
            name: 'Treasury recipients',
            description: 'Approved payout addresses',
        });

        await screen.findByText('Treasury recipients');
        const details = container.querySelector('dl');
        const rows = Array.from(details.children).map((element) => element.textContent);
        const listIndexPosition = rows.indexOf('List index');

        expect(rows.slice(listIndexPosition, listIndexPosition + 8)).toEqual([
            'List index',
            '#77',
            'Name',
            'Treasury recipients',
            'Description',
            'Approved payout addresses',
            'Type',
            'Address list',
        ]);
    });

    it('shows a name without adding a description row', async () => {
        const { container } = renderList({ name: 'Treasury recipients' });

        await screen.findByText('Treasury recipients');
        const details = within(container.querySelector('dl'));
        expect(details.getByText('Name')).toBeTruthy();
        expect(details.queryByText('Description')).toBeNull();
    });

    it.each([
        ['missing', {}],
        ['empty', { name: '' }],
        ['non-string', { name: 42 }],
    ])('omits both metadata rows for a %s name', async (_case, detail) => {
        const { container } = renderList(detail);

        await screen.findByText('#77');
        const details = within(container.querySelector('dl'));
        expect(details.queryByText('Name')).toBeNull();
        expect(details.queryByText('Description')).toBeNull();
    });

    it('neutralizes a right-to-left override in the rendered name', async () => {
        const rlo = String.fromCharCode(0x202E);
        renderList({ name: `Safe${rlo}name` });

        expect(await screen.findByText('Safe\u2426name')).toBeTruthy();
        expect(screen.queryByText(`Safe${rlo}name`)).toBeNull();
    });
});
