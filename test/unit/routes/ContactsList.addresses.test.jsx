// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// View Contact's addresses (operator ruling 2026-11-15, G124). The header
// keeps the avatar and name; the notes move into Details. Three tabs:
// Actions, Addresses, Details. Addresses is one card per address (layout 5):
// the coin with its icon, the full address, and Copy, Send and Remove
// buttons on the card. Send opens the Send form with that address in To and
// its network chosen; Remove asks only "Remove this address?" with Cancel
// and Remove. Under the cards, the "Add address" row opens the Add Address
// page (paste or scan, network read from the address, optional Label, green
// Save Address). Details holds Name, Networks, Addresses count, Added and
// the notes.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { ContactsList } from '../../../packages/core/src/shared/routes/ContactsList.jsx';

const copied = vi.hoisted(() => ({ values: [] }));
vi.mock('../../../packages/core/src/shared/clipboard.js', async (importOriginal) => ({
    ...(await importOriginal()),
    copyText: async (value) => { copied.values.push(value); return { ok: true, native: false }; },
}));

const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const LTC = 'ltc1qg82rffhs37lynnvf3tfxcuvtlhm0fwwpv3l5z6';
const BTC_2 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const NOTES = 'Met at the Denver meetup. Prefers Litecoin for small payments.';

function aaron() {
    return {
        schemaVersion: 1,
        id: 'c-aaron',
        name: 'Aaron Calloway',
        notes: NOTES,
        entries: [
            { chain: 'bitcoin', address: BTC, label: 'Savings' },
            { chain: 'litecoin', address: LTC, label: '' },
        ],
        avatarSeed: BTC,
        // Midday UTC, so the local day is 12 Oct in every test timezone.
        createdAt: '2026-10-12T12:00:00.000Z',
        updatedAt: '2026-10-12T12:00:00.000Z',
    };
}

function makeMessaging(initial = [aaron()]) {
    const store = new Map(initial.map((item) => [item.id, item]));
    return {
        store,
        listContacts: vi.fn(async () => [...store.values()]),
        saveContact: vi.fn(async ({ record }) => {
            const saved = { ...record, updatedAt: new Date(Date.parse(record.updatedAt) + 1000).toISOString() };
            store.set(saved.id, saved);
            return saved;
        }),
        deleteContact: vi.fn(async ({ id }) => { store.delete(id); }),
    };
}

async function openContact(props = {}, messaging = makeMessaging()) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <ContactsList walletId="w1" onBack={() => {}} {...props} />
            </ToastHost>
        </MessagingProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Aaron Calloway' }));
    return messaging;
}

function openAddressesTab() {
    fireEvent.click(screen.getByRole('tab', { name: /Addresses/ }));
    return screen.getByRole('list', { name: 'Addresses' });
}

function cards() {
    return within(screen.getByRole('list', { name: 'Addresses' })).getAllByRole('listitem');
}

afterEach(() => {
    cleanup();
    copied.values.length = 0;
});

describe('View Contact header and tabs', () => {
    it('orders the tabs Actions, Addresses, Details, with Actions chosen first', async () => {
        await openContact();
        const tabs = within(screen.getByRole('tablist', { name: 'Contact sections' })).getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Actions', 'Addresses', 'Details']);
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
        for (const tab of tabs) expect(tab.querySelector('svg')).not.toBeNull();
    });

    it('keeps the notes out of the header and shows them under Details with the facts', async () => {
        await openContact();
        // Actions is open: the notes are nowhere on screen.
        expect(screen.queryByText(NOTES)).toBeNull();
        expect(screen.getAllByText('Aaron Calloway').length).toBeGreaterThan(0);
        // G124's header is only the avatar and contact name, with no fact label.
        expect(screen.queryByText('Name')).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
        const factsCard = document.querySelector('[data-contact-facts]');
        const pairs = [...factsCard.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]);
        expect(pairs).toEqual([
            ['Name', 'Aaron Calloway'],
            ['Networks', 'Bitcoin, Litecoin'],
            ['Addresses', '2'],
            ['Added', '12 Oct 2026'],
        ]);
        const notes = screen.getByRole('region', { name: 'Notes' });
        expect(notes).toHaveTextContent(NOTES);
        // Details no longer holds the address list or an Addresses header.
        expect(screen.queryByRole('list', { name: 'Addresses' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Add address' })).toBeNull();
    });
});

describe('Addresses tab cards', () => {
    it('draws one card per address: coin icon and name, the full address, Copy, Send and Remove', async () => {
        await openContact({ onSend: vi.fn() });
        openAddressesTab();
        const [btc, ltc] = cards();
        expect(cards()).toHaveLength(2);
        expect(btc).toHaveTextContent('Bitcoin');
        expect(btc).toHaveTextContent('Savings');
        expect(btc).toHaveTextContent('BTC');
        expect(ltc).toHaveTextContent('Litecoin');
        expect(ltc).toHaveTextContent('LTC');
        // The coin's icon leads the card.
        expect(btc.querySelector('img, [aria-label="Unknown network"]')).not.toBeNull();
        // The whole address, never cut (AddressText with truncate off).
        expect(btc).toHaveTextContent(BTC);
        expect(ltc).toHaveTextContent(LTC);
        expect(within(btc).getAllByRole('button').map((b) => b.textContent.trim())).toEqual(['Copy', 'Send', 'Remove']);
        expect(within(btc).getByRole('button', { name: 'Remove Bitcoin address' })).toBeTruthy();
    });

    it('copies the card\'s address', async () => {
        await openContact();
        openAddressesTab();
        fireEvent.click(within(cards()[1]).getByRole('button', { name: 'Copy Litecoin address' }));
        await waitFor(() => expect(copied.values).toEqual([LTC]));
        expect(await screen.findByText('Address copied.')).toBeTruthy();
    });

    it('opens Send with this address in To and its network chosen', async () => {
        const onSend = vi.fn();
        await openContact({ onSend });
        openAddressesTab();
        fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Send to Bitcoin address' }));
        expect(onSend).toHaveBeenCalledWith({ chainId: 'bitcoin-mainnet', address: BTC });
        fireEvent.click(within(cards()[1]).getByRole('button', { name: 'Send to Litecoin address' }));
        expect(onSend).toHaveBeenLastCalledWith({ chainId: 'litecoin-mainnet', address: LTC });
    });

    it('asks only "Remove this address?" with Cancel and Remove, then takes it off', async () => {
        const messaging = await openContact();
        openAddressesTab();
        fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Remove Bitcoin address' }));

        const dialog = await screen.findByRole('dialog', { name: 'Remove this address?' });
        // No other copy: no message line, only the title and the two buttons.
        expect(dialog.getAttribute('aria-describedby')).toBeNull();
        expect(within(dialog).getAllByRole('button').map((b) => b.textContent.trim())).toEqual(['Cancel', 'Remove']);
        // Every word in the dialog is the title or a button label.
        const rest = ['Remove this address?', 'Cancel', 'Remove']
            .reduce((text, part) => text.replace(part, ''), dialog.textContent);
        expect(rest.trim()).toBe('');
        expect(dialog).not.toHaveTextContent(/keeps|later|again/i);
        fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

        await waitFor(() => expect(messaging.saveContact).toHaveBeenCalledOnce());
        expect(messaging.saveContact.mock.calls[0][0].record.entries).toEqual([
            { chain: 'litecoin', address: LTC, label: '' },
        ]);
        await waitFor(() => expect(cards()).toHaveLength(1));
        expect(screen.getByRole('tab', { name: /Addresses/, selected: true })).toBeTruthy();
    });

    it('keeps the address when Remove is cancelled', async () => {
        const messaging = await openContact();
        openAddressesTab();
        fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Remove Bitcoin address' }));
        const dialog = await screen.findByRole('dialog', { name: 'Remove this address?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(messaging.saveContact).not.toHaveBeenCalled();
        expect(cards()).toHaveLength(2);
    });
});

describe('Add Address page', () => {
    it('offers "Add address" with its helper line under the cards', async () => {
        await openContact();
        const list = openAddressesTab();
        const add = screen.getByRole('button', { name: /^Add address/ });
        expect(add).toHaveTextContent('Save another address for this contact');
        expect(list.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('saves a pasted address with its label and returns to the Addresses tab', async () => {
        const messaging = await openContact();
        openAddressesTab();
        fireEvent.click(screen.getByRole('button', { name: /^Add address/ }));

        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Add Address');
        // Scan sits inside the address field (U53).
        expect(screen.getByRole('button', { name: 'Scan a QR code' })).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Address'), { target: { value: BTC_2 } });
        // The network is read from the address.
        expect(screen.getByText('Network: Bitcoin')).toBeTruthy();
        fireEvent.change(screen.getByLabelText(/^Label/), { target: { value: 'Tips jar' } });
        const save = screen.getByRole('button', { name: 'Save Address' });
        expect(save.className).toMatch(/success/);
        fireEvent.click(save);

        await waitFor(() => expect(messaging.saveContact).toHaveBeenCalledOnce());
        expect(messaging.saveContact.mock.calls[0][0].record.entries).toEqual([
            { chain: 'bitcoin', address: BTC, label: 'Savings' },
            { chain: 'litecoin', address: LTC, label: '' },
            { chain: 'bitcoin', address: BTC_2, label: 'Tips jar' },
        ]);
        expect(await screen.findByRole('tab', { name: /Addresses/, selected: true })).toBeTruthy();
        expect(cards()).toHaveLength(3);
        expect(cards()[2]).toHaveTextContent('Tips jar');
    });

    it('refuses a non-address on the field and saves nothing', async () => {
        const messaging = await openContact();
        openAddressesTab();
        fireEvent.click(screen.getByRole('button', { name: /^Add address/ }));
        fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'not an address' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Address' }));
        const notice = await screen.findByText('Fix 1 thing to continue');
        expect(notice.closest('[data-variant="error"]')).toHaveTextContent('This is not a valid Bitcoin, Litecoin, or Dogecoin address.');
        expect(screen.getAllByText('This is not a valid Bitcoin, Litecoin, or Dogecoin address.')).toHaveLength(2);
        expect(screen.getByLabelText('Address')).toHaveAttribute('aria-invalid', 'true');
        expect(messaging.saveContact).not.toHaveBeenCalled();
    });

    it('does not clear an address error when only the optional label changes', async () => {
        await openContact();
        openAddressesTab();
        fireEvent.click(screen.getByRole('button', { name: /^Add address/ }));
        fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'not an address' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Address' }));
        await screen.findByText('Fix 1 thing to continue');
        fireEvent.change(screen.getByLabelText(/^Label/), { target: { value: 'Tips' } });
        expect(screen.getByText('Fix 1 thing to continue')).toBeTruthy();
        expect(screen.getByLabelText('Address')).toHaveAttribute('aria-invalid', 'true');
    });

    it('goes Back to the Addresses tab without saving', async () => {
        const messaging = await openContact();
        openAddressesTab();
        fireEvent.click(screen.getByRole('button', { name: /^Add address/ }));
        fireEvent.click(screen.getByRole('button', { name: /Back/ }));
        expect(await screen.findByRole('tab', { name: /Addresses/, selected: true })).toBeTruthy();
        expect(messaging.saveContact).not.toHaveBeenCalled();
    });
});
