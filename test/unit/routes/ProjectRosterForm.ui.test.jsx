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

// Tokens join the list only through the token picker; this stand-in picks
// whatever ticker is typed into it, on the chain the form locked it to.
vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, chainIdFilter, onSelect, onBack }) => (
        <section aria-label={title}>
            <input aria-label="Token to pick" id="pick-tick" />
            <button type="button" onClick={() => onSelect({ chainId: chainIdFilter, tick: document.getElementById('pick-tick').value })}>Pick token</button>
            <button type="button" onClick={onBack}>Close token picker</button>
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
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());

        // Network and From live in the standard From section, closed
        // on load; the address field is labelled "From address".
        fireEvent.click(screen.getByRole('button', { name: /^From/, expanded: false }));
        const network = screen.getByRole('button', { name: /^Network:/ });
        const from = screen.getByLabelText('From address', { selector: 'input' });
        expect(network.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        await waitFor(() => expect(from).toHaveValue(OWNER.address));

        const paragraphs = Array.from(container.querySelectorAll('p'))
            .map((node) => node.textContent)
            .join(' ');
        expect(paragraphs).not.toContain('show an "Official" badge in explorers and wallets');

        expectHelp('From address', 'Only the current owner of PROJ can publish its official-token list.');
        expectHelp(
            'Tokens',
            'Tokens on PROJ\'s list show an "Official" badge in explorers and wallets. Put one token per line, or add one from the token picker.',
        );
        // Tokens are typed one per line, like the List create page.
        expect(screen.getByRole('textbox', { name: /^Tokens/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add Token' }).querySelector('svg[data-xc-icon]')).not.toBeNull();
        // Memo is its own optional section, closed on load.
        // It holds only the memo, so the field has no label row or tip (ruling).
        fireEvent.click(screen.getByRole('button', { name: /^Memo/, expanded: false }));
        expect(screen.queryByRole('button', { name: 'About Memo' })).toBeNull();
        expect(screen.getByRole('textbox', { name: 'Memo' })).toBeInTheDocument();

        // A network without list metadata leaves out the List Details section.
        expect(screen.queryByLabelText(/List name/)).toBeNull();
        expect(screen.queryByRole('button', { name: /^List Details/ })).toBeNull();
        expect(screen.getByText(/doesn't take a list name or description yet/)).toBeTruthy();
        // No list yet, so the main action creates it and links it.
        const save = screen.getByRole('button', { name: 'Create and Link' });
        expect(save.className).toMatch(/success/);
        expect(save.querySelector('svg[data-xc-icon]')).not.toBeNull();
    });

    it('opens the From picker on the form network and accepts its chain change', async () => {
        mount();
        const from = await screen.findByLabelText('From address', { selector: 'input' });
        await waitFor(() => expect(from).toHaveValue(OWNER.address));

        // Open the standard From section to reach the picker icon.
        fireEvent.click(screen.getByRole('button', { name: /^From/, expanded: false }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose source address' }));
        expect(screen.getByRole('region', { name: 'From address picker' })).toBeTruthy();
        expect(screen.getByTestId('picker-chain')).toHaveTextContent(CHAIN);

        fireEvent.click(screen.getByRole('button', { name: 'Pick another network address' }));
        expect(await screen.findByRole('button', { name: /Network: Litecoin/i })).toBeTruthy();
        expect(screen.getByLabelText('From address', { selector: 'input' })).toHaveValue(OTHER.address);
        expect(screen.getByRole('alert')).toHaveTextContent('This wallet does not own PROJ');
    });

    it('renders reviewed tokens as icon rows in one card', async () => {
        mount();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add Token' })).toBeEnabled());
        for (const tick of ['FIRST', 'SECOND']) {
            fireEvent.click(screen.getByRole('button', { name: 'Add Token' }));
            fireEvent.change(screen.getByLabelText('Token to pick'), { target: { value: tick } });
            fireEvent.click(screen.getByRole('button', { name: 'Pick token' }));
        }
        fireEvent.click(screen.getByRole('button', { name: 'Create and Link' })); // A first list is created, then linked.

        const roster = await screen.findByRole('list', { name: 'Tokens' });
        const rows = screen.getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        expect(rows.every((row) => row.parentElement === roster)).toBe(true);
        expect(rows[0]).toHaveTextContent('FIRST');
        expect(rows[1]).toHaveTextContent('SECOND');
        expect(screen.getByRole('img', { name: /FIRST on Dogecoin/i })).toBeTruthy();
        expect(screen.getByRole('img', { name: /SECOND on Dogecoin/i })).toBeTruthy();
        expect(roster.className).toMatch(/rosterList/);

        const publish = screen.getByRole('button', { name: 'Publish List' });
        expect(publish.className).toMatch(/success/);
        expect(publish.querySelector('svg[data-xc-icon]')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Back to Edit' }).querySelector('svg[data-xc-icon]')).not.toBeNull();
    });
});
