// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ProjectRosterForm } from '../../../packages/core/src/shared/routes/ProjectRosterForm.jsx';

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ chainId, onChainChange, onPick, onBack }) => (
        <section aria-label="From address picker">
            <span data-testid="picker-chain">{chainId}</span>
            <button
                type="button"
                onClick={() => {
                    onChainChange('litecoin-testnet');
                    onPick({ id: 'address-2', address: 'mOtherChainOwner' });
                }}
            >
                Pick another network address
            </button>
            <button type="button" onClick={onBack}>Close picker</button>
        </section>
    ),
}));

const CHAIN = 'dogecoin-testnet';
const OWNER = {
    id: 'address-1',
    address: 'DProjectOwnerAddress',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/3'/0'/0/0",
    source: 'hd',
};
const OTHER = {
    id: 'address-2',
    address: 'mOtherChainOwner',
    publicKey: '03'.padEnd(66, 'b'),
    derivationPath: "m/84'/1'/0'/0/0",
    source: 'hd',
};

function messagingWith(overrides = {}) {
    return {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'locked' }),
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [OWNER],
            'litecoin-testnet': [OTHER],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [CHAIN]: { id: OWNER.id },
            'litecoin-testnet': { id: OTHER.id },
        }),
        getGenesisForToken: vi.fn().mockResolvedValue({ action_index: 77 }),
        getProjectForToken: vi.fn().mockResolvedValue(null),
        ...overrides,
    };
}

function mount(messaging = messagingWith()) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ProjectRosterForm
                walletId="wallet-1"
                chainId={CHAIN}
                tick="PROJ"
                issuerAddress={OWNER.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

function expectHelp(label, copy) {
    fireEvent.click(screen.getByRole('button', { name: `About ${label}` }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(copy);
    fireEvent.keyDown(document, { key: 'Escape' });
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ProjectRosterForm roster controls', () => {
    it('opens with Network then From and keeps form-specific help on field labels', async () => {
        const { container } = mount();
        await screen.findByText('No list published yet. This will be the first.');

        const network = screen.getByRole('button', { name: /^Network:/ });
        const from = screen.getByLabelText('From', { selector: 'input' });
        expect(network.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        await waitFor(() => expect(from).toHaveValue(OWNER.address));

        const paragraphs = Array.from(container.querySelectorAll('p'))
            .map((node) => node.textContent)
            .join(' ');
        expect(paragraphs).not.toContain('show an "Official" badge in explorers and wallets');

        expectHelp('From', 'Only the current owner of PROJ can publish its official-token list.');
        expectHelp(
            'Tokens (one per line)',
            'Tokens on PROJ\'s official-token list show an "Official" badge in explorers and wallets. Publishing a new list replaces the old one. Enter one token name per line.',
        );
        expectHelp('Memo', 'An optional note stored with the link that makes this roster official.');

        expect(screen.getByText('Optional')).toBeTruthy();
        expect(screen.getByText('0 / 250')).toBeTruthy();
        const save = screen.getByRole('button', { name: 'Save roster' });
        expect(save.className).toMatch(/success/);
        expect(save.querySelector('svg[data-xc-icon]')).not.toBeNull();
    });

    it('opens the From picker on the form network and accepts its chain change', async () => {
        mount();
        const from = await screen.findByLabelText('From', { selector: 'input' });
        await waitFor(() => expect(from).toHaveValue(OWNER.address));

        fireEvent.click(screen.getByRole('button', { name: 'Choose source address' }));
        expect(screen.getByRole('region', { name: 'From address picker' })).toBeTruthy();
        expect(screen.getByTestId('picker-chain')).toHaveTextContent(CHAIN);

        fireEvent.click(screen.getByRole('button', { name: 'Pick another network address' }));
        expect(await screen.findByRole('button', { name: /Network: Litecoin/i })).toBeTruthy();
        expect(screen.getByLabelText('From', { selector: 'input' })).toHaveValue(OTHER.address);
        expect(screen.getByRole('alert')).toHaveTextContent('This wallet does not own PROJ');
    });

    it('renders reviewed tokens as icon rows in one card', async () => {
        mount();
        await screen.findByText('No list published yet. This will be the first.');
        fireEvent.change(screen.getByLabelText('Tokens (one per line)'), {
            target: { value: 'FIRST\nSECOND' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save roster' }));

        const roster = await screen.findByRole('list', { name: 'Tokens' });
        const rows = screen.getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        expect(rows.every((row) => row.parentElement === roster)).toBe(true);
        expect(rows[0]).toHaveTextContent('FIRST');
        expect(rows[1]).toHaveTextContent('SECOND');
        expect(screen.getByRole('img', { name: /FIRST on Dogecoin/i })).toBeTruthy();
        expect(screen.getByRole('img', { name: /SECOND on Dogecoin/i })).toBeTruthy();
        expect(roster.className).toMatch(/rosterList/);

        const publish = screen.getByRole('button', { name: 'Publish list' });
        expect(publish.className).toMatch(/success/);
        expect(publish.querySelector('svg[data-xc-icon]')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Back to edit' }).querySelector('svg[data-xc-icon]')).not.toBeNull();
    });
});
