// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings, Appearance, Tokens: the list page with Watched, Pinned and Hidden
// tabs (no counts), rows that open a token's own page, and the Add Watched
// Token page the plus opens.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenListsSection } from '../../../packages/core/src/shared/components/settings/TokenListsSection.jsx';
import { AddWatchedTokenSection } from '../../../packages/core/src/shared/components/settings/AddWatchedTokenSection.jsx';

afterEach(() => cleanup());

function makeMessaging(overrides = {}, messagingOverrides = {}) {
    let settings = {
        pinnedTokens: [],
        watchedTokens: [],
        hiddenTokens: [],
        ...overrides,
    };
    return {
        getSettings: vi.fn(() => Promise.resolve(settings)),
        updateSettings: vi.fn((patch) => {
            settings = { ...settings, ...patch };
            return Promise.resolve(settings);
        }),
        searchTokens: vi.fn(() => Promise.resolve([])),
        ...messagingOverrides,
    };
}

function renderWith(messaging, element) {
    return render(<MessagingProvider shell="web" messaging={messaging}>{element}</MessagingProvider>);
}

const FULL = {
    watchedTokens: ['bitcoin-mainnet:PEPECASH', 'bitcoin-mainnet:RAREPEPE'],
    pinnedTokens: ['bitcoin-mainnet:XCP'],
    hiddenTokens: ['bitcoin-mainnet:BANANA', 'bitcoin-mainnet:RUSTBITS'],
};

describe('TokenListsSection', () => {
    it('shows Watched, Pinned and Hidden tabs with no counts, Watched first', async () => {
        renderWith(makeMessaging(FULL), <TokenListsSection />);
        const tabs = await screen.findAllByRole('radio').catch(() => []);
        const group = (await screen.findByText('Watched')).closest('[aria-label="Token lists"]');
        expect(group).not.toBeNull();
        const buttons = within(group).getAllByRole(tabs.length ? 'radio' : 'button');
        expect(buttons.map((button) => button.textContent.replace('★', '').trim())).toEqual(['Watched', 'Pinned', 'Hidden']);
        for (const button of buttons) expect(button.textContent).not.toMatch(/\d/);
        expect(screen.getByRole('heading', { name: 'Tokens' })).toBeInTheDocument();
    });

    it('lists the wallet token rows (ticker, network line) for the chosen tab', async () => {
        renderWith(makeMessaging(FULL), <TokenListsSection />);
        const list = await screen.findByRole('list', { name: 'Watched' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(2);
        expect(within(list).getAllByText('Bitcoin')).toHaveLength(2);
        expect(within(list).queryByText('PEPECASH, Bitcoin')).toBeNull();

        fireEvent.click(screen.getByText('Pinned'));
        const pinned = await screen.findByRole('list', { name: 'Pinned' });
        expect(within(pinned).getByText('Bitcoin')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Hidden'));
        const hidden = await screen.findByRole('list', { name: 'Hidden' });
        expect(hidden.querySelectorAll(':scope > li[data-token-key]')).toHaveLength(2);
    });

    it('opens the token page from a row', async () => {
        const onOpenToken = vi.fn();
        renderWith(makeMessaging(FULL), <TokenListsSection onOpenToken={onOpenToken} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Open PEPECASH on Bitcoin' }));
        expect(onOpenToken).toHaveBeenCalledWith({ chainId: 'bitcoin-mainnet', tick: 'PEPECASH', kind: 'token' });
    });

    it('shows an empty state per tab and no Unhide All when nothing is hidden', async () => {
        renderWith(makeMessaging(), <TokenListsSection />);
        expect(await screen.findByText('No watched tokens')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Pinned'));
        expect(await screen.findByText('No pinned tokens')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Hidden'));
        expect(await screen.findByText('No hidden tokens')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Unhide All/i })).toBeNull();
    });

    it('puts Unhide All in the hidden list card as a full row and clears the hidden list', async () => {
        const messaging = makeMessaging(FULL);
        renderWith(messaging, <TokenListsSection />);
        fireEvent.click(await screen.findByText('Hidden'));
        const list = await screen.findByRole('list', { name: 'Hidden' });
        const button = within(list).getByRole('button', { name: /Unhide All/i });
        expect(button.querySelector('svg')).not.toBeNull();
        expect(button.closest('li')).toHaveAttribute('data-token-action', 'unhide-all');
        expect(button.closest('li').previousElementSibling).toHaveAttribute('data-token-key', 'bitcoin-mainnet:RUSTBITS');
        // Only on the Hidden tab.
        fireEvent.click(screen.getByText('Watched'));
        expect(screen.queryByRole('button', { name: /Unhide All/i })).toBeNull();
        fireEvent.click(screen.getByText('Hidden'));
        fireEvent.click(await screen.findByRole('button', { name: /Unhide All/i }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({ hiddenTokens: [] }));
        expect(await screen.findByText('No hidden tokens')).toBeInTheDocument();
    });

    it('opens Add Watched Token from the plus in the header', async () => {
        const onOpenPage = vi.fn();
        renderWith(makeMessaging(FULL), <TokenListsSection onOpenPage={onOpenPage} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Add watched token' }));
        expect(onOpenPage).toHaveBeenCalledWith('display-tokens-add');
    });

    it('carries no old in-page add form', async () => {
        renderWith(makeMessaging(FULL), <TokenListsSection />);
        await screen.findByText('Watched');
        expect(screen.queryByRole('textbox', { name: 'Token ticker' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Watch Token' })).toBeNull();
    });
});

describe('AddWatchedTokenSection', () => {
    it('searches every network, marks watched tokens and watches a result with its plus', async () => {
        const searchTokens = vi.fn(({ chainId }) => Promise.resolve(
            chainId === 'bitcoin-mainnet'
                ? [{ tick: 'PEPECASH' }, { tick: 'PEPECREATURE' }]
                : chainId === 'dogecoin-mainnet' ? [{ tick: 'PEPE' }] : [],
        ));
        const messaging = makeMessaging(
            { watchedTokens: ['bitcoin-mainnet:PEPECASH'], hiddenTokens: ['bitcoin-mainnet:PEPECREATURE'] },
            { searchTokens },
        );
        renderWith(messaging, <AddWatchedTokenSection />);
        fireEvent.change(await screen.findByRole('searchbox', { name: 'Search tokens to watch' }), { target: { value: 'pepe' } });

        const results = await screen.findByRole('list', { name: 'Search results' });
        expect(searchTokens.mock.calls.map(([arg]) => arg.chainId)).toEqual(
            expect.arrayContaining(['bitcoin-mainnet', 'dogecoin-mainnet', 'litecoin-mainnet']),
        );
        expect(within(results).getAllByRole('listitem')).toHaveLength(3);
        const watched = within(results).getByText('PEPECASH').closest('li');
        expect(within(watched).getByText('Watching')).toBeInTheDocument();
        expect(within(watched).queryByRole('button')).toBeNull();

        fireEvent.click(within(results).getByRole('button', { name: 'Watch PEPE on Dogecoin' }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({
            watchedTokens: ['bitcoin-mainnet:PEPECASH', 'dogecoin-mainnet:PEPE'],
            hiddenTokens: ['bitcoin-mainnet:PEPECREATURE'],
        }));
        await waitFor(() => expect(within(results.querySelector('[data-token-key="dogecoin-mainnet:PEPE"]')).getByText('Watching')).toBeInTheDocument());
    });

    it('unhides a hidden token when it is watched', async () => {
        const messaging = makeMessaging(
            { hiddenTokens: ['bitcoin-mainnet:PEPECREATURE'] },
            { searchTokens: vi.fn(({ chainId }) => Promise.resolve(chainId === 'bitcoin-mainnet' ? [{ tick: 'PEPECREATURE' }] : [])) },
        );
        renderWith(messaging, <AddWatchedTokenSection />);
        fireEvent.change(await screen.findByRole('searchbox', { name: 'Search tokens to watch' }), { target: { value: 'PEPEC' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Watch PEPECREATURE on Bitcoin' }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({
            watchedTokens: ['bitcoin-mainnet:PEPECREATURE'],
            hiddenTokens: [],
        }));
    });

    it('says so when nothing is found and leaves no ticker form', async () => {
        renderWith(makeMessaging(), <AddWatchedTokenSection />);
        fireEvent.change(await screen.findByRole('searchbox', { name: 'Search tokens to watch' }), { target: { value: 'zzzz' } });
        expect(await screen.findByText('No tokens found')).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Token ticker' })).toBeNull();
    });
});
