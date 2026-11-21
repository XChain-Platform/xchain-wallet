// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// On-chain preferences against the app-wide rulings: the form opens with
// Network, then From (U60), and picking another own address edits that
// address, reloading its current values; every choice carries a help tip and
// no how-it-works box stands in for it (U57); the main action is named and
// iconned (U63); Memo and the network fee are not filed under Dispensers.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const CHAIN = 'bitcoin-regtest';
const ADDR_A = { id: 'a0', address: 'bcrt1qprefsprefsprefsprefsprefsprefsprefs00', source: 'hd' };
const ADDR_B = { id: 'a1', address: 'bcrt1qotherotherotherotherotherotherother11', source: 'hd' };

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ chainId, onPick }) => (
        <section data-testid="own-address-picker" data-chain-id={chainId}>
            <button type="button" onClick={() => onPick(ADDR_B)}>Pick the other address</button>
        </section>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Icon } from '../../../packages/core/src/ui/index.js';
import { AddressPreferencesForm } from '../../../packages/core/src/shared/routes/AddressPreferencesForm.jsx';

afterEach(() => cleanup());

function mount(readPreferences) {
    const getAddressPreferences = vi.fn(readPreferences || (({ address }) => Promise.resolve(address === ADDR_B.address
        ? { onChain: true, feePreference: 1, requireMemo: 1, dispenserPreference: 2 }
        : { onChain: false, feePreference: 0, requireMemo: 0, dispenserPreference: 0 })));
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDR_A, ADDR_B] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: ADDR_A }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getAddressPreferences,
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <AddressPreferencesForm walletId="w" chainId={CHAIN} address={ADDR_A.address} onBack={() => {}} />
        </MessagingProvider>,
    );
    return { getAddressPreferences };
}

describe('AddressPreferencesForm rulings', () => {
    it('opens Address Info with the QR icon, and closed it shows the address shortened', async () => {
        mount();
        await screen.findByLabelText('Address');
        const header = screen.getByRole('button', { name: /^Address Info/ });
        expect(header).toHaveAttribute('aria-expanded', 'true');
        // The generic QR code icon, not the wallet icon the From section uses.
        const { container: qr } = render(<Icon.ReceiveIcon />);
        expect(header.querySelector('svg').innerHTML).toBe(qr.querySelector('svg').innerHTML);

        fireEvent.click(header);
        expect(header).toHaveAttribute('aria-expanded', 'false');
        // G99: the closed summary's address is the fitting AddressText.
        expect(header.querySelector(`[aria-label="${ADDR_A.address}"]`)).not.toBeNull();
    });

    it('opens with Network, then Address, with tips and no disclosure box', async () => {
        mount();
        const from = await screen.findByLabelText('Address');
        expect(from).toHaveValue(ADDR_A.address);
        const network = screen.getByRole('button', { name: /^Network:/ });
        const follows = Node.DOCUMENT_POSITION_FOLLOWING;
        expect(network.compareDocumentPosition(from) & follows).toBeTruthy();
        // Protocol Fee Handling is the open main section right after Address Info.
        const feeChoice = screen.getByRole('button', { name: /^How the protocol fee is handled:/ });
        expect(from.compareDocumentPosition(feeChoice) & follows).toBeTruthy();
        expect(screen.queryByText('Who can see these preferences?')).toBeNull();
        openSection(/^Incoming Sends/);
        openSection(/^Dispensers/);
        openSection(/^Memo/);
        for (const name of ['About Address', 'About How the protocol fee is handled', 'About Require memo on incoming sends', 'About Who may open dispensers']) {
            expect(screen.getByRole('button', { name })).toBeInTheDocument();
        }
        // A memo alone in its Memo section has no label row and no tip (ruling).
        expect(screen.queryByRole('button', { name: 'About Memo' })).toBeNull();
        expect(screen.getByRole('textbox', { name: 'Memo' })).toBeInTheDocument();
    });

    it('keeps Memo and the network fee out of the Dispensers section', async () => {
        mount();
        await screen.findByLabelText('Address');
        openSection(/^Dispensers/);
        openSection(/^Memo/);
        const dispensers = screen.getByRole('button', { name: /^Who may open dispensers:/ }).closest('section');
        const memo = screen.getByLabelText('Memo');
        expect(dispensers.contains(memo)).toBe(false);
        // Memo is its own optional section, and the network fee is the shared
        // Fees section; neither sits inside Dispensers.
        expect(memo.closest('section')).toHaveAttribute('data-form-section', 'memo');
        const feeToggle = screen.getByRole('button', { name: /^Speed and Fees/ });
        expect(dispensers.contains(feeToggle)).toBe(false);
        expect(screen.queryByRole('heading', { name: 'Memo and network fee' })).toBeNull();
    });

    it('offers the memo requirement as a No or Yes choice', async () => {
        mount();
        await screen.findByLabelText('Address');
        openSection(/^Incoming Sends/);
        fireEvent.click(screen.getByRole('button', { name: 'Require memo on incoming sends: No' }));
        expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['No', 'Yes']);
        fireEvent.click(screen.getByRole('option', { name: 'Yes' }));
        expect(screen.getByRole('button', { name: 'Require memo on incoming sends: Yes' })).toBeInTheDocument();
    });

    it('names its main action Update Preferences with an icon', async () => {
        mount();
        await screen.findByLabelText('Address');
        const submit = screen.getByRole('button', { name: 'Update Preferences' });
        expect(submit.className).toMatch(/success/);
        expect(submit.querySelector('svg')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
    });

    it('keeps raw explorer failures in a closed technical disclosure inside the error notice', async () => {
        let reads = 0;
        mount(() => {
            reads += 1;
            if (reads === 1) {
                return Promise.resolve({ feePreference: 0, requireMemo: 0, dispenserPreference: 0 });
            }
            return Promise.reject(Object.assign(
                new Error('Explorer returned HTTP 502 for /api/addresses/example/preferences'),
                { name: 'SDKExplorerError' },
            ));
        });
        fireEvent.click(await screen.findByRole('button', { name: 'Update Preferences' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load the current preferences.");
        expect(alert).toHaveTextContent('temporarily unavailable (error 502)');
        expect(alert).toHaveTextContent('Try again in a moment');
        expect(alert).toHaveTextContent('Review needs a live read');
        // The raw text sits only in the notice's own collapsed disclosure, at
        // the bottom of the box (the StatusMessage details pattern), never
        // loose beside it or in the shown sentence.
        const details = alert.querySelectorAll('details');
        expect(details).toHaveLength(1);
        expect(details[0].open).toBe(false);
        expect(details[0].querySelector('summary')).toHaveTextContent(/^Technical details$/);
        expect(details[0]).toHaveTextContent('Explorer returned HTTP 502');
        const shown = alert.cloneNode(true);
        shown.querySelectorAll('details').forEach((node) => node.remove());
        expect(shown).not.toHaveTextContent(/Explorer returned HTTP|\/api\//);
        expect(document.querySelectorAll('[data-form-status] details')).toHaveLength(1);
    });

    it('picking another own address edits that address and reloads its values', async () => {
        const { getAddressPreferences } = mount();
        await waitFor(() => expect(getAddressPreferences).toHaveBeenCalledWith({ chainId: CHAIN, address: ADDR_A.address }));
        // A pick made for the first address must not carry over.
        fireEvent.click(await screen.findByRole('button', { name: 'How the protocol fee is handled: Donate to protocol development' }));
        fireEvent.click(screen.getByRole('option', { name: 'Destroy (reduces supply)' }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose source address' }));
        expect(screen.getByTestId('own-address-picker')).toHaveAttribute('data-chain-id', CHAIN);
        fireEvent.click(screen.getByRole('button', { name: 'Pick the other address' }));

        expect(await screen.findByLabelText('Address')).toHaveValue(ADDR_B.address);
        await waitFor(() => expect(getAddressPreferences).toHaveBeenCalledWith({ chainId: CHAIN, address: ADDR_B.address }));
        openSection(/^Incoming Sends/);
        openSection(/^Dispensers/);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Require memo on incoming sends: Yes' })).toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Who may open dispensers: Anyone' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'How the protocol fee is handled: Destroy (reduces supply)' })).toBeInTheDocument();
    });
});

// Opens a closed Form Standard section by its header (title plus summary).
function openSection(title) {
    const header = screen.getByRole('button', { name: title, expanded: false });
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
}
