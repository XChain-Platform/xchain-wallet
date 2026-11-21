// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Connected Sites, approved Layout 1: a header filter and plus, an
// Allowed | Blocked | Options toggle, list cards that drill into a site or
// a blocked entry, a Block Site form behind the plus, and the sign-request
// throttle as a small form with no fees. No block history is shown.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { pngDataUrl } from '../../helpers/siteIconFixtures.js';
import { selectOption } from '../../helpers/selectOption.js';

let messaging;
let settings;
let update;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
}));
vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast: vi.fn() }),
}));

const { ConnectedSitesSection } = await import(
    '../../../packages/core/src/shared/components/settings/ConnectedSitesSection.jsx'
);

const PNG = pngDataUrl();

const site = (id, origin, appName, extra = {}) => ({
    schemaVersion: 1,
    id,
    origin,
    appName,
    appIcon: '',
    connectedAt: '2026-10-28T00:00:00.000Z',
    lastUsedAt: '2026-10-28T00:00:00.000Z',
    permissions: { chains: ['bitcoin'], accounts: ['acct-1'], canSignMessage: true, canSignAction: {} },
    sessionHistory: [],
    ...extra,
});

let connected;
let blockedList;

beforeEach(() => {
    settings = { ...createDefaultSettings(), signThrottle: { burst: 5, windowMs: 60000 } };
    update = vi.fn(async () => settings);
    connected = [
        site('s1', 'https://market.dankest.example', 'Dankest Market', { icon: PNG }),
        site('s2', 'https://app.pepeswap.example', 'PepeSwap'),
    ];
    blockedList = ['*.scam.example', 'https://claim-airdrop.example'];
    messaging = {
        listConnectedSites: vi.fn(async () => connected),
        listBlockedOrigins: vi.fn(async () => blockedList),
        blockOrigin: vi.fn(async ({ origin }) => { blockedList = [...blockedList, origin]; }),
        unblockOrigin: vi.fn(async ({ origin }) => { blockedList = blockedList.filter((e) => e !== origin); }),
        deleteConnectedSite: vi.fn(async ({ id }) => { connected = connected.filter((s) => s.id !== id); }),
        listBlocklistAuditLog: vi.fn(async () => []),
        clearBlocklistAuditLog: vi.fn(),
    };
});

afterEach(() => cleanup());

const rowFor = async (text) => (await screen.findByText(text)).closest('button');
const showView = async (name) => fireEvent.click(await screen.findByRole('radio', { name }));

describe('Connected Sites layout', () => {
    it('puts the filter and the plus in the header and a three-way toggle under it', async () => {
        render(<ConnectedSitesSection />);
        // The smallest box holding the title and the filter is the header
        // row, and the toggle sits outside it, under the header.
        let header = await screen.findByRole('heading', { level: 1, name: 'Connected Sites' });
        while (header && !header.querySelector('[aria-label="Filter sites"]')) header = header.parentElement;
        expect(header).not.toBeNull();
        expect(header.contains(screen.getByRole('radiogroup', { name: 'Connected sites view' }))).toBe(false);
        expect(within(header).getByRole('button', { name: 'Filter sites' })).toBeTruthy();
        expect(within(header).getByRole('button', { name: 'Block a site' })).toBeTruthy();
        const toggle = screen.getByRole('radiogroup', { name: 'Connected sites view' });
        expect(within(toggle).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Allowed', 'Blocked', 'Options']);
        expect(within(toggle).getByRole('radio', { name: 'Allowed' })).toHaveAttribute('aria-checked', 'true');
    });

    it('lists each allowed site in one card with "origin · last used" and a chevron', async () => {
        render(<ConnectedSitesSection />);
        const list = await screen.findByRole('list', { name: 'Allowed sites' });
        const rows = within(list).getAllByRole('button');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveTextContent('Dankest Market');
        expect(rows[0]).toHaveTextContent(/https:\/\/market\.dankest\.example · /);
        for (const row of rows) expect(row.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    });

    it('lists blocked entries with their kind and only the facts the blocklist stores', async () => {
        render(<ConnectedSitesSection />);
        await showView('Blocked');
        const list = await screen.findByRole('list', { name: 'Blocked sites' });
        const rows = within(list).getAllByRole('button');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveTextContent('*.scam.example');
        expect(rows[0]).toHaveTextContent('Wildcard, all subdomains');
        expect(rows[1]).toHaveTextContent('Single origin');
        expect(screen.queryByText(/refused|Blocked on|Last attempt/i)).toBeNull();
    });

    it('shows no block history anywhere on the page', async () => {
        render(<ConnectedSitesSection />);
        for (const view of ['Allowed', 'Blocked', 'Options']) {
            await showView(view);
            expect(screen.queryByText(/history/i)).toBeNull();
        }
        expect(messaging.listBlocklistAuditLog).not.toHaveBeenCalled();
    });
});

describe('Connected Sites icons', () => {
    it('shows a site\'s own PNG icon through the shared SiteIcon', async () => {
        render(<ConnectedSitesSection />);
        const row = await rowFor('Dankest Market');
        expect(row.querySelector('[data-site-icon="image"] img')?.getAttribute('src')).toBe(PNG);
        fireEvent.click(row);
        const card = await screen.findByRole('region', { name: 'Site identity' });
        expect(card.querySelector('[data-site-icon="image"] img')?.getAttribute('src')).toBe(PNG);
    });

    it('falls back to initials without fetching, and never renders appIcon', async () => {
        connected = [
            site('s2', 'https://app.pepeswap.example', 'PepeSwap', { appIcon: 'https://app.pepeswap.example/logo.png' }),
            site('s3', 'https://remote.example', 'Remote Icon', { icon: 'https://remote.example/icon.png' }),
        ];
        render(<ConnectedSitesSection />);
        for (const [name, initials] of [['PepeSwap', 'PE'], ['Remote Icon', 'RI']]) {
            const row = await rowFor(name);
            expect(row.querySelector('img')).toBeNull();
            expect(row.querySelector('[data-site-icon="initials"]')).toHaveTextContent(initials);
        }
        fireEvent.click(await rowFor('PepeSwap'));
        const card = await screen.findByRole('region', { name: 'Site identity' });
        expect(card.querySelector('img')).toBeNull();
        expect(card.querySelector('[data-site-icon="initials"]')).toHaveTextContent('PE');
        expect(document.querySelector('img[src*="logo.png"], img[src*="icon.png"]')).toBeNull();
    });

    it('gives blocked rows initials from the host they block', async () => {
        render(<ConnectedSitesSection />);
        await showView('Blocked');
        const row = await rowFor('*.scam.example');
        expect(row.querySelector('[data-site-icon="initials"]')).toHaveTextContent('SC');
    });
});

describe('Connected Sites site detail', () => {
    it('shows the identity card, label-left permission rows and connection facts', async () => {
        render(<ConnectedSitesSection />);
        fireEvent.click(await rowFor('PepeSwap'));

        expect(await screen.findByRole('heading', { level: 1, name: 'Site Identity' })).toBeTruthy();
        expect(await screen.findByRole('heading', { level: 2, name: 'PepeSwap' })).toBeTruthy();
        const permissions = screen.getByRole('list', { name: 'Permissions' });
        expect(permissions).toHaveTextContent('Networksbitcoin');
        expect(permissions).toHaveTextContent('Accountsacct-1');
        expect(permissions).toHaveTextContent('Sign messagesAlways allow');
        const connection = screen.getByRole('list', { name: 'Connection' });
        expect(connection).toHaveTextContent('Connected since2026-10-28');
        expect(connection).toHaveTextContent('Last used');
        expect(screen.queryByRole('radiogroup')).toBeNull();
    });

    it('shows empty account and chain grants as bridge wildcards', async () => {
        connected = [{
            ...connected[0],
            id: 'wildcard',
            appName: 'Wildcard App',
            permissions: {
                chains: [],
                accounts: [],
                canSignMessage: false,
                canSignAction: {},
            },
        }];
        render(<ConnectedSitesSection />);
        fireEvent.click(await rowFor('Wildcard App'));

        const permissions = await screen.findByRole('list', { name: 'Permissions' });
        expect(permissions).toHaveTextContent('NetworksAll networks');
        expect(permissions).toHaveTextContent('AccountsAll accounts, including ones you add later');
        expect(permissions).not.toHaveTextContent('None');
    });

    it('disconnects through the confirm and returns to the list', async () => {
        render(<ConnectedSitesSection />);
        fireEvent.click(await rowFor('PepeSwap'));
        fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
        fireEvent.click(screen.getByRole('button', { name: 'Disconnect site' }));

        await waitFor(() => expect(messaging.deleteConnectedSite).toHaveBeenCalledWith({ id: 's2' }));
        const list = await screen.findByRole('list', { name: 'Allowed sites' });
        expect(within(list).queryByText('PepeSwap')).toBeNull();
    });

    it('blocks the site through the confirm', async () => {
        render(<ConnectedSitesSection />);
        fireEvent.click(await rowFor('PepeSwap'));
        fireEvent.click(await screen.findByRole('button', { name: 'Block Site' }));
        fireEvent.click(screen.getByRole('button', { name: 'Block site' }));

        await waitFor(() => expect(messaging.blockOrigin).toHaveBeenCalledWith({ origin: 'https://app.pepeswap.example' }));
    });

    it('returns to the list from the header back', async () => {
        render(<ConnectedSitesSection />);
        fireEvent.click(await rowFor('PepeSwap'));
        await screen.findByRole('heading', { level: 2, name: 'PepeSwap' });
        const back = screen.getAllByRole('button').find((b) => /back/i.test(b.getAttribute('aria-label') || ''));
        fireEvent.click(back);
        expect(await screen.findByRole('list', { name: 'Allowed sites' })).toBeTruthy();
    });
});

describe('Connected Sites blocked entry detail', () => {
    it('unblocks from a standard action row and returns to the Blocked list', async () => {
        render(<ConnectedSitesSection />);
        await showView('Blocked');
        fireEvent.click(await rowFor('*.scam.example'));

        expect(await screen.findByRole('heading', { level: 1, name: 'Blocked Entry' })).toBeTruthy();
        expect(await screen.findByRole('region', { name: 'Blocked entry' })).toHaveTextContent('Wildcard, all subdomains');
        const unblock = screen.getByRole('button', { name: 'Unblock' });
        expect(screen.getByRole('list', { name: 'Site actions' })).toContainElement(unblock);
        expect(unblock).toHaveAttribute('data-tone', 'default');
        fireEvent.click(unblock);

        await waitFor(() => expect(messaging.unblockOrigin).toHaveBeenCalledWith({ origin: '*.scam.example' }));
        const list = await screen.findByRole('list', { name: 'Blocked sites' });
        expect(within(list).queryByText('*.scam.example')).toBeNull();
    });
});

describe('Connected Sites Block Site form', () => {
    const openForm = async () => {
        render(<ConnectedSitesSection />);
        fireEvent.click(await screen.findByRole('button', { name: 'Block a site' }));
        return screen.findByRole('textbox', { name: 'Origin or wildcard to block' });
    };

    it('refuses an empty entry at the field', async () => {
        const field = await openForm();
        fireEvent.click(screen.getByRole('button', { name: 'Block Site' }));
        expect(await screen.findAllByText('Enter an origin or wildcard to block.')).toHaveLength(2);
        expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent('Fix 1 thing to continue');
        expect(field).toHaveAttribute('aria-invalid', 'true');
        fireEvent.change(field, { target: { value: 'https://valid.example' } });
        expect(screen.queryByRole('alert', { name: 'Form errors' })).toBeNull();
        expect(field).not.toHaveAttribute('aria-invalid');
        expect(messaging.blockOrigin).not.toHaveBeenCalled();
    });

    it('refuses a malformed origin with the host\'s own normalizer', async () => {
        const field = await openForm();
        fireEvent.change(field, { target: { value: 'https://' } });
        fireEvent.click(screen.getByRole('button', { name: 'Block Site' }));
        expect(await screen.findAllByText('Enter an origin such as https://example.com, or a wildcard such as *.example.com.')).toHaveLength(2);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(messaging.blockOrigin).not.toHaveBeenCalled();
    });

    it('blocks a wildcard after the confirm and shows the Blocked list', async () => {
        const field = await openForm();
        fireEvent.change(field, { target: { value: '*.evil.example' } });
        fireEvent.click(screen.getByRole('button', { name: 'Block Site' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Block site' }));

        await waitFor(() => expect(messaging.blockOrigin).toHaveBeenCalledWith({ origin: '*.evil.example' }));
        const list = await screen.findByRole('list', { name: 'Blocked sites' });
        expect(within(list).getByText('*.evil.example')).toBeTruthy();
    });
});

describe('Connected Sites Options', () => {
    it('is the status card and two inline rows, with no Speed and Fees, no Advanced and no Save', async () => {
        render(<ConnectedSitesSection />);
        await showView('Options');

        const panel = await screen.findByTestId('sign-throttle-panel');
        expect(screen.queryByText(/Speed and Fees/i)).toBeNull();
        expect(screen.queryByText(/^Advanced$/i)).toBeNull();
        expect(within(panel).getByTestId('throttle-select-burst')).toBeTruthy();
        expect(within(panel).getByTestId('throttle-select-windowMs')).toBeTruthy();
        expect(within(panel).getAllByRole('button', { name: /^About / })).toHaveLength(2);
        expect(within(panel).getByTestId('throttle-status')).toHaveTextContent('In effect now5 sign requests per site per minute');
        expect(within(panel).queryByRole('button', { name: /apply|save/i })).toBeNull();
    });

    it('applies new throttle limits at once', async () => {
        render(<ConnectedSitesSection />);
        await showView('Options');
        selectOption(await screen.findByTestId('throttle-select-burst'), '10');
        await waitFor(() => expect(update).toHaveBeenCalledWith({ signThrottle: { burst: 10, windowMs: 60000 } }));
        selectOption(screen.getByTestId('throttle-select-windowMs'), '30000');
        await waitFor(() => expect(update).toHaveBeenLastCalledWith({ signThrottle: { burst: 5, windowMs: 30000 } }));
    });
});

describe('Connected Sites from a Settings search', () => {
    it('opens on the view that holds the matched row, and only for a row title', async () => {
        const { unmount } = render(<ConnectedSitesSection searchTarget="Requests per site" />);
        expect(await screen.findByRole('radio', { name: 'Options' })).toHaveAttribute('aria-checked', 'true');
        unmount();
        render(<ConnectedSitesSection searchTarget="blockchain.example" />);
        expect(await screen.findByRole('radio', { name: 'Allowed' })).toHaveAttribute('aria-checked', 'true');
    });
});

describe('Connected Sites filter', () => {
    it('narrows the Allowed and Blocked lists by the search text', async () => {
        render(<ConnectedSitesSection />);
        fireEvent.click(await screen.findByRole('button', { name: 'Filter sites' }));
        fireEvent.change(await screen.findByRole('searchbox', { name: 'Search sites' }), { target: { value: 'pepe' } });

        const allowed = screen.getByRole('list', { name: 'Allowed sites' });
        expect(within(allowed).getAllByRole('button')).toHaveLength(1);
        expect(within(allowed).getByText('PepeSwap')).toBeTruthy();

        await showView('Blocked');
        expect(await screen.findByText('No sites match this search')).toBeTruthy();
    });
});
