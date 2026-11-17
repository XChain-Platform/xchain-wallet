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

// The form sits on the Wallet Form Standard frame; Network and From
// live in the closed From section and Memo and Pack in closed sections, so a
// test opens a section before it reaches for a field inside.
async function openSection(title) {
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${title}\\b`), expanded: false }));
}

describe('GatedPublishForm fields and pickers', () => {
    it('orders the context fields first and keeps static explanations in help tips', async () => {
        // The Pack question shows only when a reusable pack exists,
        // so this vault holds one for its help tip to be checked.
        const messaging = client();
        messaging.listGatedKeys.mockResolvedValue([{ keyHash: 'a'.repeat(64) }]);
        mount(messaging);

        await openSection('From');
        await openSection('Memo');
        await openSection('Access');
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
        // A memo alone in its Memo section has no label row and no tip (ruling).
        expect(screen.queryByRole('button', { name: 'About Memo' })).toBeNull();
        expect(screen.getByRole('button', { name: 'About Pack' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^About File \(up to/ }));
        const fileHelp = screen.getByRole('tooltip');
        const packHelp = screen.getByText('Files published under one pack share a single key and unlock together.');
        expect(fileHelp).toHaveTextContent('Permanent:');
        expect(packHelp.closest('[role="tooltip"]')).not.toBeNull();
        expect(document.querySelector('p[role="note"]')).toBeNull();
        expect(screen.queryByText('No reusable packs yet')).toBeNull();

        const publish = screen.getByRole('button', { name: /^Publish file$/i });
        expect(publish.className).toContain('success');
        expect(publish.querySelector('svg')).not.toBeNull();
    });

    it('opens the standard token picker on owned tokens and switches the gate, network, and owner', async () => {
        mount();
        const tokenField = await screen.findByRole('button', { name: /^Token: GATE/ });
        await waitFor(() => expect(tokenField).toBeEnabled());
        expect(screen.getByRole('heading', { name: /^Gated Content/ })).toBeInTheDocument();
        fireEvent.click(tokenField);

        // The picker's own title, not the form's, over only the owned tokens.
        expect(await screen.findByRole('heading', { name: 'Select Token' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /^Gated Content/ })).toBeNull();
        const option = (tick) => (name) => name.startsWith(`Select ${tick} on `);
        await screen.findByRole('button', { name: option('LIT') });
        expect(screen.getByRole('button', { name: option('GATE') })).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: (name) => name.startsWith('Select ') })).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: option('LIT') }));

        await openSection('From');
        expect(await screen.findByRole('button', { name: /^Network: Litecoin/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Token: LIT/ })).toBeInTheDocument();
        expect(screen.getByLabelText('From')).toHaveValue(LITECOIN_OWNER.address);
        // The title is Title Case.
        expect(screen.getByRole('heading', { name: 'Gated Content · LIT' })).toBeInTheDocument();
    });

    it('opens the From picker filtered to the network and follows a cross-network pick', async () => {
        mount();
        await screen.findByDisplayValue(BITCOIN_OWNER.address);
        await openSection('From');
        // The address-book icon is labelled in Title Case.
        fireEvent.click(screen.getByRole('button', { name: 'From Address' }));

        expect(await screen.findByText(`Filtered to ${BITCOIN}`)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Switch to Litecoin' }));
        expect(await screen.findByText(`Filtered to ${LITECOIN}`)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Pick Litecoin owner' }));

        expect(await screen.findByRole('button', { name: /^Network: Litecoin/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Token: LIT/ })).toBeInTheDocument();
        expect(screen.getByLabelText('From')).toHaveValue(LITECOIN_OWNER.address);
    });
});
