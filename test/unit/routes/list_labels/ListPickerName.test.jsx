// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '@xchain-wallet/core/shared/MessagingProvider.jsx';

vi.mock('@xchain-wallet/core/shared/components/ListPickerScreen.jsx', async () => {
    const ReactModule = await import('react');
    return {
        ListPickerScreen({ title, onSelect }) {
            const kind = title.includes('allow') ? 'allow-list' : 'block-list';
            const named = kind === 'allow-list'
                ? { actionIndex: '41', type: '2', memberCount: null, name: 'Treasury allow' }
                : { actionIndex: '42', type: '2', memberCount: null, name: 'Treasury block' };
            const unnamed = kind === 'allow-list'
                ? { actionIndex: '51', type: '2', memberCount: null }
                : { actionIndex: '52', type: '2', memberCount: null };
            return ReactModule.createElement(
                'div',
                null,
                ReactModule.createElement(
                    'button',
                    { type: 'button', onClick: () => onSelect(named) },
                    `Pick named ${kind}`,
                ),
                ReactModule.createElement(
                    'button',
                    { type: 'button', onClick: () => onSelect(unnamed) },
                    `Pick unnamed ${kind}`,
                ),
            );
        },
    };
});

const { TokenWizard } = await import('@xchain-wallet/core/shared/routes/TokenWizard.jsx');

const ADDRESSES = {
    'bitcoin-mainnet': [
        {
            id: 'addr-1',
            address: 'bc1qexampleexampleexampleexampleexampleex',
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        },
    ],
};

function mountWizard() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 900000 }),
    };
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(TokenWizard, { walletId: 'w', onBack() {} }),
        ),
    );
}

async function driveToAccessLists() {
    fireEvent.click(await screen.findByText('Custom'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: /Advanced settings/i }));
}

function listRow(label) {
    return screen.getByText(label).parentElement.parentElement;
}

afterEach(() => cleanup());

describe('ListPickerScreen selection name', () => {
    it('adds only a non-empty string name to the selected row payload', async () => {
        const { ListPickerScreen } = await vi.importActual(
            '@xchain-wallet/core/shared/components/ListPickerScreen.jsx',
        );
        const onSelect = vi.fn();
        const messaging = {
            getListsForSource: vi.fn().mockResolvedValue([
                { action_index: '10', type: '2', name: 'VIP wallets' },
                { action_index: '11', type: '2' },
                { action_index: '12', type: '2', name: '' },
            ]),
            getListByActionIndex: vi.fn().mockResolvedValue({ type: '2', list: ['a', 'b'] }),
        };
        render(
            <ListPickerScreen
                variant="full"
                messaging={messaging}
                chainId="c"
                addresses={[{ address: 'addr1' }]}
                filterType="2"
                onSelect={onSelect}
                onBack={() => {}}
            />,
        );

        await waitFor(() => expect(screen.getAllByText('2 members')).toHaveLength(3));
        fireEvent.click(screen.getByText('VIP wallets (List #10)').closest('button'));
        fireEvent.click(screen.getByText('Address list #11').closest('button'));
        fireEvent.click(screen.getByText('Address list #12').closest('button'));

        expect(onSelect.mock.calls).toEqual([
            [{ actionIndex: '10', type: '2', memberCount: 2, name: 'VIP wallets' }],
            [{ actionIndex: '11', type: '2', memberCount: 2 }],
            [{ actionIndex: '12', type: '2', memberCount: 2 }],
        ]);
    });
});

describe('TokenWizard list names', () => {
    it('shows named allow-list and block-list picks and clears their labels with Remove', async () => {
        mountWizard();
        await driveToAccessLists();

        fireEvent.click(screen.getByRole('button', { name: 'Choose allow-list' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick named allow-list' }));
        expect(screen.getByText('Treasury allow (List #41)')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Choose block-list' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick named block-list' }));
        expect(screen.getByText('Treasury block (List #42)')).toBeTruthy();

        fireEvent.click(within(listRow('Allow-list')).getByRole('button', { name: 'Remove' }));
        expect(screen.getByText('None (anyone may interact)')).toBeTruthy();
        expect(screen.queryByText('Treasury allow (List #41)')).toBeNull();

        fireEvent.click(within(listRow('Block-list')).getByRole('button', { name: 'Remove' }));
        expect(screen.getByText('None')).toBeTruthy();
        expect(screen.queryByText('Treasury block (List #42)')).toBeNull();
    });

    it('keeps the existing label for an unnamed pick', async () => {
        mountWizard();
        await driveToAccessLists();

        fireEvent.click(screen.getByRole('button', { name: 'Choose allow-list' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick unnamed allow-list' }));

        expect(screen.getByText('List #51')).toBeTruthy();
    });
});
