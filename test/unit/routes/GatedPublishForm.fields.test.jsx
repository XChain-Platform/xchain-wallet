// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { GatedPublishForm } from '../../../packages/core/src/shared/routes/GatedPublishForm.jsx';

const BITCOIN = 'bitcoin-regtest';
const LITECOIN = 'litecoin-regtest';
const BITCOIN_OWNER = {
    id: 'btc-owner',
    address: 'bc1qgateowner',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-btc',
};
const BITCOIN_OTHER = {
    ...BITCOIN_OWNER,
    id: 'btc-other',
    address: 'bc1qotheraddress',
};
const LITECOIN_OWNER = {
    ...BITCOIN_OWNER,
    id: 'ltc-owner',
    address: 'rltc1qgateowner',
    signerId: 'signer-ltc',
};

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', async () => {
    const { createElement } = await import('react');
    return {
        OwnAddressPickerScreen: ({ chainId, onChainChange, onPick, onBack }) => createElement(
            'section',
            { 'aria-label': 'From address picker' },
            createElement('p', null, `Filtered to ${chainId}`),
            createElement('button', { type: 'button', onClick: () => onChainChange(LITECOIN) }, 'Switch to Litecoin'),
            createElement('button', { type: 'button', onClick: () => onPick(LITECOIN_OWNER) }, 'Pick Litecoin owner'),
            createElement('button', { type: 'button', onClick: onBack }, 'Back'),
        ),
    };
});

function client() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [BITCOIN]: [BITCOIN_OWNER, BITCOIN_OTHER],
            [LITECOIN]: [LITECOIN_OWNER],
        }),
        getOwnedTokens: vi.fn(({ chainId, address }) => {
            if (chainId === BITCOIN && address === BITCOIN_OWNER.address) {
                return Promise.resolve([{ tick: 'GATE' }]);
            }
            if (chainId === LITECOIN && address === LITECOIN_OWNER.address) {
                return Promise.resolve([{ tick: 'LIT' }]);
            }
            return Promise.resolve([]);
        }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        listGatedKeys: vi.fn().mockResolvedValue([]),
        getTokenInfo: vi.fn().mockResolvedValue({ creator: BITCOIN_OWNER.address, divisibility: 8 }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue([]);
        },
    });
}

function mount(messaging = client()) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <GatedPublishForm
                walletId="wallet-1"
                chainId={BITCOIN}
                tick="GATE"
                issuerAddress={BITCOIN_OWNER.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

afterEach(cleanup);

describe('GatedPublishForm fields and pickers', () => {
    it('orders the context fields first and keeps static explanations in help tips', async () => {
        mount();

        const network = await screen.findByRole('button', { name: /^Network: Bitcoin/ });
        const from = screen.getByLabelText('From');
        const token = await screen.findByRole('button', { name: /^Token: GATE/ });
        const file = screen.getByLabelText('File to publish');
        const fields = [network, from, token, file];

        for (let index = 1; index < fields.length; index += 1) {
            expect(fields[index - 1].compareDocumentPosition(fields[index]))
                .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        }

        expect(from).toHaveValue(BITCOIN_OWNER.address);
        expect(screen.getByRole('button', { name: 'About From' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^About File \(up to/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Title' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Memo' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Pack' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^About File \(up to/ }));
        const fileHelp = screen.getByRole('tooltip');
        const packHelp = screen.getByText('Files published under one pack share a single key and unlock together.');
        expect(fileHelp).toHaveTextContent('Permanent:');
        expect(packHelp.closest('[role="tooltip"]')).not.toBeNull();
        expect(document.querySelector('p[role="note"]')).toBeNull();
        expect(screen.queryByText('No reusable packs yet')).toBeNull();

        const publish = screen.getByRole('button', { name: 'Publish file' });
        expect(publish.className).toContain('success');
        expect(publish.querySelector('svg')).not.toBeNull();
    });

    it('lists owned tokens in one card and switches the gate, network, and owner', async () => {
        mount();
        const tokenField = await screen.findByRole('button', { name: /^Token: GATE/ });
        await waitFor(() => expect(tokenField).toBeEnabled());
        fireEvent.click(tokenField);

        const list = await screen.findByRole('list');
        expect(list.children).toHaveLength(2);
        const litecoinToken = screen.getByText('LIT').closest('button');
        expect(litecoinToken).not.toBeNull();
        fireEvent.click(litecoinToken);

        expect(await screen.findByRole('button', { name: /^Network: Litecoin/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Token: LIT/ })).toBeInTheDocument();
        expect(screen.getByLabelText('From')).toHaveValue(LITECOIN_OWNER.address);
        expect(screen.getByRole('heading', { name: 'Gated content · LIT' })).toBeInTheDocument();
    });

    it('opens the From picker filtered to the network and follows a cross-network pick', async () => {
        mount();
        await screen.findByDisplayValue(BITCOIN_OWNER.address);
        fireEvent.click(screen.getByRole('button', { name: 'From address' }));

        expect(await screen.findByText(`Filtered to ${BITCOIN}`)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Switch to Litecoin' }));
        expect(await screen.findByText(`Filtered to ${LITECOIN}`)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Pick Litecoin owner' }));

        expect(await screen.findByRole('button', { name: /^Network: Litecoin/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Token: LIT/ })).toBeInTheDocument();
        expect(screen.getByLabelText('From')).toHaveValue(LITECOIN_OWNER.address);
    });
});
