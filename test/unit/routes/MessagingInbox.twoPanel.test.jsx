// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { LIST_DETAIL_MIN_WIDTH } from '../../../packages/core/src/shared/components/PanelSplit.jsx';
import { MessagingInbox } from '../../../packages/core/src/shared/routes/MessagingInbox.jsx';
import { explorerPageUrl } from '../../../packages/core/src/shared/utils/explorerLinks.js';

const CHAIN = 'bitcoin-testnet';
const OWNER = 'bc1qownerownerownerownerownerownerownerowner';
const ALPHA = 'bc1qalphaalphaalphaalphaalphaalphaalphaalpha';
const BETA = 'bc1qbetabetabetabetabetabetabetabetabeta';
let layoutWidth = 0;
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
        if (this.hasAttribute('data-list-detail')) {
            return { width: layoutWidth, height: 800, top: 0, left: 0, right: layoutWidth, bottom: 800, x: 0, y: 0, toJSON() {} };
        }
        return realRect.call(this);
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    layoutWidth = 0;
    localStorage.clear();
});

function makeMessaging() {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'owner-1', address: OWNER, source: 'hd', role: 'receive' }],
        }),
        listContacts: vi.fn().mockResolvedValue([
            { id: 'alpha', name: 'Alpha Person', entries: [{ address: ALPHA }] },
            { id: 'beta', name: 'Beta Person', entries: [{ address: BETA }] },
        ]),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getMessagingInboxSweep: vi.fn().mockResolvedValue({
            messages: [
                { format: 2, method: 0, chainId: CHAIN, from: ALPHA, to: OWNER, txid: 'a1', text: 'Newest alpha message', timestamp: 200 },
                { format: 2, method: 0, chainId: CHAIN, from: BETA, to: OWNER, txid: 'b1', text: 'Older beta message', timestamp: 100 },
            ],
            addresses: [],
            errors: [],
        }),
    };
}

function mount(props = {}) {
    const messaging = makeMessaging();
    const onBack = vi.fn();
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <MessagingInbox walletId="wallet-1" onCompose={() => {}} onBack={onBack} {...props} />
        </MessagingProvider>,
    );
    return { messaging, onBack };
}

describe('MessagingInbox two panels', () => {
    it('starts the wide list frame 8px under the header with a full-width selected row', () => {
        const css = readFileSync('packages/core/src/shared/routes/MessagingInbox.module.css', 'utf8');
        const panelCss = readFileSync('packages/core/src/shared/components/PanelSplit.module.css', 'utf8');
        const cardCss = readFileSync('packages/core/src/ui/Card.module.css', 'utf8');
        const tokens = readFileSync('packages/core/src/ui/tokens.css', 'utf8');
        const list = css.match(/\.convList\s*\{([^}]*)\}/);
        const selectedRow = css.match(/\.convList\[data-wide='true'\] \.convItem\[aria-current='true'\]\s*\{([^}]*)\}/);
        const listBody = panelCss.match(/\.listBody\s*\{([^}]*)\}/);

        expect(list).not.toBeNull();
        expect(list[1]).toMatch(/composes:\s*flush from '\.\.\/\.\.\/ui\/Card\.module\.css'/);
        expect(list[1]).toMatch(/overflow:\s*hidden/);
        expect(cardCss).toMatch(/:root \[data-xc-split-list\]\s*\{[^}]*border:\s*var\(--xc-card-border\);[^}]*border-radius:\s*var\(--xc-card-radius\);[^}]*overflow:\s*hidden/s);
        expect(listBody[1]).toMatch(/padding-block-start:\s*var\(--xc-space-2\)/);
        expect(tokens).toMatch(/--xc-space-2:\s*8px/);
        expect(selectedRow).not.toBeNull();
        expect(selectedRow[1]).toMatch(/background:\s*color-mix\([^;]*--xc-accent-primary[^;]*20%/);
        expect(selectedRow[1]).toMatch(/width:\s*100%/);
        expect(selectedRow[1]).toMatch(/margin-inline:\s*0/);
        expect(selectedRow[1]).toMatch(/border-radius:\s*0/);
        expect(selectedRow[1]).toMatch(/box-shadow:\s*none/);
    });

    it('preselects the first conversation and uses the shared persisted split', async () => {
        layoutWidth = 1046;
        mount();

        const detail = await screen.findByRole('region', { name: 'Alpha Person' });
        expect(within(detail).getByText('Newest alpha message')).toBeInTheDocument();
        expect(within(detail).getByRole('textbox', { name: 'Reply, press Enter to send' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Alpha Person/ })).toHaveAttribute('aria-current', 'true');
        expect(screen.getByRole('button', { name: /Beta Person/ })).not.toHaveAttribute('aria-current');
        const separator = screen.getByRole('separator', { name: 'Resize the conversation list' });
        expect(separator).toHaveAttribute('aria-controls');
        expect(readFileSync('packages/core/src/shared/routes/MessagingInbox.jsx', 'utf8'))
            .toMatch(/<ListDetailSplit[\s\S]*?storageKey="messaging"/);
    });

    it('has one page toolbar and no toolbar in the wide conversation panel', async () => {
        layoutWidth = 1046;
        mount();

        const detail = await screen.findByRole('region', { name: 'Alpha Person' });
        expect(within(detail).queryByRole('heading')).toBeNull();
        expect(within(detail).queryByRole('button', { name: 'Filter messages' })).toBeNull();
        expect(within(detail).queryByRole('button', { name: 'Conversation menu' })).toBeNull();
        expect(screen.getAllByRole('button', { name: 'Filter messaging' })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'More' })).toHaveLength(1);
        expect(screen.queryByRole('button', { name: 'New message' })).toBeNull();
    });

    it('uses one active search for conversation text and open-thread matches, then clears both', async () => {
        layoutWidth = 1046;
        mount();
        await screen.findByRole('region', { name: 'Alpha Person' });

        const filter = screen.getByRole('button', { name: 'Filter messaging' });
        fireEvent.click(filter);
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search conversations and messages' }), {
            target: { value: 'Newest alpha' },
        });

        const list = screen.getByRole('list', { name: 'Conversations' });
        expect(within(list).getByRole('button', { name: /Alpha Person/ })).toBeInTheDocument();
        expect(within(list).queryByRole('button', { name: /Beta Person/ })).toBeNull();
        expect(document.querySelector('mark')).toHaveTextContent('Newest alpha');
        expect(filter).toHaveAttribute('data-active', 'true');

        fireEvent.click(screen.getByRole('button', { name: 'Clear Search' }));
        expect(within(list).getByRole('button', { name: /Beta Person/ })).toBeInTheDocument();
        expect(document.querySelector('mark')).toBeNull();
        expect(filter).not.toHaveAttribute('data-active');
    });

    it('puts all six wide actions in More and targets the latest transaction', async () => {
        layoutWidth = 1046;
        const onCompose = vi.fn();
        const onContact = vi.fn();
        mount({ onCompose, onContact });
        await screen.findByRole('region', { name: 'Alpha Person' });

        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        let menu = screen.getByRole('menu', { name: 'Messaging actions' });
        expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
            'New Message',
            'New Contact',
            'Edit Contact',
            'Copy Message',
            'View in Explorer',
            'Encryption Details',
        ]);
        expect(within(menu).getByRole('menuitem', { name: 'View in Explorer' })).toHaveAttribute(
            'href',
            explorerPageUrl({ chainId: CHAIN, kind: 'transaction', value: 'a1' }),
        );

        fireEvent.click(within(menu).getByRole('menuitem', { name: 'New Message' }));
        expect(onCompose).toHaveBeenCalledWith();
        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        menu = screen.getByRole('menu', { name: 'Messaging actions' });
        fireEvent.click(within(menu).getByRole('menuitem', { name: 'New Contact' }));
        expect(onContact).toHaveBeenCalledWith({ address: '', edit: false });
        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        menu = screen.getByRole('menu', { name: 'Messaging actions' });
        fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit Contact' }));
        expect(onContact).toHaveBeenCalledWith({ address: ALPHA, chainId: CHAIN, edit: true });
    });

    it('swaps the detail in place without invoking page navigation', async () => {
        layoutWidth = 1046;
        const { messaging, onBack } = mount();
        const list = await screen.findByRole('list', { name: 'Conversations' });
        await screen.findByRole('region', { name: 'Alpha Person' });

        fireEvent.click(within(list).getByRole('button', { name: /Beta Person/ }));

        const detail = await screen.findByRole('region', { name: 'Beta Person' });
        expect(within(detail).getByText('Older beta message')).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Alpha Person' })).toBeNull();
        expect(screen.getByRole('list', { name: 'Conversations' })).toBe(list);
        expect(onBack).not.toHaveBeenCalled();
        expect(messaging.getMessagingInboxSweep).toHaveBeenCalledTimes(1);
    });

    it('keeps a deep-linked conversation selected and preserves page Back', async () => {
        layoutWidth = 1046;
        const { onBack } = mount({ initialCounterparty: BETA });

        expect(await screen.findByRole('region', { name: 'Beta Person' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Beta Person/ })).toHaveAttribute('aria-current', 'true');
        fireEvent.click(screen.getByRole('button', { name: /^Back/ }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('keeps the existing list then thread flow below the breakpoint', async () => {
        layoutWidth = LIST_DETAIL_MIN_WIDTH - 1;
        mount();
        const list = await screen.findByRole('list', { name: 'Conversations' });
        expect(screen.queryByRole('separator')).toBeNull();
        expect(screen.queryByRole('region', { name: 'Alpha Person' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Filter conversations' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'New message' })).toBeInTheDocument();

        fireEvent.click(within(list).getByRole('button', { name: /Beta Person/ }));

        expect(await screen.findByRole('heading', { level: 1, name: 'Beta Person' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Filter messages' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Conversation menu' })).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole('list', { name: 'Conversations' })).toBeNull());
        expect(screen.queryByRole('separator')).toBeNull();
    });
});
