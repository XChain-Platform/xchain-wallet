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
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '@xchain-wallet/core/shared/MessagingProvider.jsx';

vi.mock('@xchain-wallet/core/shared/components/ListPickerScreen.jsx', async () => {
    const ReactModule = await import('react');
    return {
        ListPickerScreen({ title, onSelect }) {
            const kind = title.toLowerCase().includes('allow') ? 'allow-list' : 'block-list';
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

// The Create a token route: TokenWizard renders the one Issue Token form,
// whose Allow and block lists section opens this picker.
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

let messaging;

function mountWizard() {
    messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 900000 }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
    };
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(TokenWizard, { walletId: 'w', onBack() {} }),
        ),
    );
}

// The lists live in the closed Allow and block lists section.
async function driveToAccessLists() {
    await screen.findByLabelText('Ticker');
    fireEvent.click(screen.getByRole('button', { name: /^Allow and block lists/, expanded: false }));
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
        fireEvent.click(screen.getByRole('button', { name: /VIP wallets \(List #10\)/ }));
        fireEvent.click(screen.getByRole('button', { name: /Address list #11/ }));
        fireEvent.click(screen.getByRole('button', { name: /Address list #12/ }));

        expect(onSelect.mock.calls).toEqual([
            [{ actionIndex: '10', type: '2', memberCount: 2, name: 'VIP wallets' }],
            [{ actionIndex: '11', type: '2', memberCount: 2 }],
            [{ actionIndex: '12', type: '2', memberCount: 2 }],
        ]);
    });
});

describe('Issue Token list names', () => {
    it('shows named allow-list and block-list picks and composes their indexes', async () => {
        mountWizard();
        await driveToAccessLists();

        fireEvent.click(screen.getByRole('button', { name: 'Choose allow-list' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick named allow-list' }));
        expect(await screen.findByText('Treasury allow (List #41)')).toBeTruthy();
        expect(screen.getByLabelText('Allow list')).toHaveValue('41');

        fireEvent.click(screen.getByRole('button', { name: 'Choose block-list' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick named block-list' }));
        expect(await screen.findByText('Treasury block (List #42)')).toBeTruthy();
        expect(screen.getByLabelText('Block list')).toHaveValue('42');

        // The picked indexes are what the ISSUE carries.
        fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'LISTED' } });
        fireEvent.click(screen.getByRole('button', { name: 'Issue Token' }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0].actionData.params).toMatchObject({
            ALLOW_LIST: '41',
            BLOCK_LIST: '42',
        });
    });

    it('clears a picked list and its label with Remove', async () => {
        mountWizard();
        await driveToAccessLists();

        fireEvent.click(screen.getByRole('button', { name: 'Choose allow-list' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick named allow-list' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Choose block-list' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick named block-list' }));
        await screen.findByText('Treasury block (List #42)');

        fireEvent.click(screen.getByRole('button', { name: 'Remove allow-list' }));
        expect(screen.getByLabelText('Allow list')).toHaveValue('');
        expect(screen.queryByText('Treasury allow (List #41)')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Remove block-list' }));
        expect(screen.getByLabelText('Block list')).toHaveValue('');
        expect(screen.queryByText('Treasury block (List #42)')).toBeNull();
    });

    it('keeps the existing label for an unnamed pick', async () => {
        mountWizard();
        await driveToAccessLists();

        fireEvent.click(screen.getByRole('button', { name: 'Choose allow-list' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick unnamed allow-list' }));

        expect(await screen.findByText('List #51')).toBeTruthy();
    });
});
