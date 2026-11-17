// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { LIST_DETAIL_MIN_WIDTH } from '../../../packages/core/src/shared/components/PanelSplit.jsx';
import { ContactsList } from '../../../packages/core/src/shared/routes/ContactsList.jsx';

let layoutWidth = 0;
const realRect = HTMLElement.prototype.getBoundingClientRect;

const contacts = [
    {
        id: 'alice',
        name: 'Alice',
        notes: '',
        entries: [{ chain: 'bitcoin', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', label: '' }],
        createdAt: '2026-10-12T12:00:00.000Z',
        updatedAt: '2026-10-12T12:00:00.000Z',
    },
    {
        id: 'bob',
        name: 'Bob',
        notes: '',
        entries: [{ chain: 'litecoin', address: 'ltc1qg82rffhs37lynnvf3tfxcuvtlhm0fwwpv3l5z6', label: '' }],
        createdAt: '2026-10-13T12:00:00.000Z',
        updatedAt: '2026-10-13T12:00:00.000Z',
    },
];

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
    globalThis.localStorage?.clear();
});

function mount() {
    const messaging = { listContacts: vi.fn().mockResolvedValue(contacts) };
    const onBack = vi.fn();
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <ContactsList walletId="wallet-1" onBack={onBack} />
            </ToastHost>
        </MessagingProvider>,
    );
    return { messaging, onBack };
}

describe('ContactsList wide split', () => {
    it('shows the list beside the first contact and remembers divider changes under contacts', async () => {
        layoutWidth = 1046;
        const { messaging } = mount();

        const detail = await screen.findByRole('region', { name: 'Alice' });
        const listRegion = screen.getByRole('region', { name: 'Contacts' });
        expect(within(detail).getByText('Alice')).toBeInTheDocument();
        expect(within(listRegion).getByRole('button', { name: 'Alice' })).toHaveAttribute('aria-current', 'true');
        expect(screen.getByRole('heading', { level: 1, name: 'Contacts' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { level: 1, name: 'View Contact' })).toBeNull();
        expect(messaging.listContacts).toHaveBeenCalledOnce();

        const divider = screen.getByRole('separator', { name: 'Resize the contacts list' });
        fireEvent.keyDown(divider, { key: 'ArrowRight' });
        const displayPrefs = JSON.parse(globalThis.localStorage?.getItem('xc:displayPrefs') || '{}');
        expect(displayPrefs.panelSplits?.contacts).toEqual(expect.any(Number));
    });

    it('swaps the detail in place without navigating or re-reading contacts', async () => {
        layoutWidth = 1686;
        const { messaging, onBack } = mount();
        await screen.findByRole('region', { name: 'Alice' });
        const list = screen.getByRole('list', { name: 'Contacts' });

        fireEvent.click(within(list).getByRole('button', { name: 'Bob' }));

        const detail = await screen.findByRole('region', { name: 'Bob' });
        expect(within(detail).getByText('Bob')).toBeInTheDocument();
        expect(screen.getByRole('list', { name: 'Contacts' })).toBe(list);
        expect(within(list).getByRole('button', { name: 'Bob' })).toHaveAttribute('aria-current', 'true');
        expect(within(list).getByRole('button', { name: 'Alice' })).not.toHaveAttribute('aria-current');
        expect(onBack).not.toHaveBeenCalled();
        expect(messaging.listContacts).toHaveBeenCalledOnce();
    });
});

describe('ContactsList below the split width', () => {
    it('keeps the list-then-detail flow', async () => {
        layoutWidth = LIST_DETAIL_MIN_WIDTH - 1;
        mount();
        const list = await screen.findByRole('list', { name: 'Contacts' });
        expect(screen.queryByRole('separator')).toBeNull();

        fireEvent.click(within(list).getByRole('button', { name: 'Bob' }));

        await waitFor(() => expect(screen.queryByRole('list', { name: 'Contacts' })).toBeNull());
        expect(screen.getByRole('heading', { level: 1, name: 'View Contact' })).toBeInTheDocument();
        expect(screen.getByText('Bob')).toBeInTheDocument();
    });
});
