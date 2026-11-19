// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// View Address draws its actions as the shared ActionList (G101) under the
// shared Actions | Details toggle (G102): Actions first and chosen, each row
// still runs its own handler, Delete carries the danger tone, and a
// watch-only address keeps its Secret key row, off, with the reason.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AddressDetail } from '../../../packages/core/src/shared/routes/AddressDetail.jsx';

const ADDRESS = 'bcrt1qplain0000000000000000000000000000000000';

afterEach(() => cleanup());

function mount(overrides = {}) {
    const handlers = {
        onReceive: vi.fn(),
        onEditPreferences: vi.fn(),
        onToggleHidden: vi.fn(),
        onSetActive: vi.fn(),
        onShowSecret: vi.fn(),
        onDelete: vi.fn(),
        onSaveLabel: vi.fn(async () => true),
    };
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
        <MessagingProvider shell="web" messaging={{ getSettings: vi.fn(async () => ({})) }}>
            <AddressDetail
                variant="page"
                onBack={() => {}}
                selected={{ chainId: 'bitcoin-regtest', address: ADDRESS, label: 'Savings', record: { id: 'a1', source: 'hd' } }}
                active={false}
                balanceText="0 BTC"
                typeText="Native SegWit"
                chainPrefs={null}
                chainPrefsError={null}
                chainPrefsPending={false}
                explorerUrl="https://explorer.example/address/x"
                overCeiling={false}
                canSecret
                labelSaving={false}
                visibilitySaving={false}
                detailAction={null}
                {...handlers}
                {...overrides}
            />
        </MessagingProvider>,
    );
    return { handlers, open };
}

describe('View Address actions (G101, G102)', () => {
    it('opens on the Actions tab, first and chosen, holding one ActionList', () => {
        mount();
        const tabs = screen.getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Actions', 'Details']);
        expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
        const list = within(screen.getByRole('tabpanel')).getByRole('list', { name: 'Actions' });
        expect(list.tagName).toBe('UL');
        const rows = within(list).getAllByRole('listitem');
        expect(rows.map((row) => row.querySelector('button')?.firstChild?.nextSibling?.firstChild?.textContent)).toEqual([
            'Receive', 'Edit label', 'On-chain prefs', 'Hide', 'Set active', 'Secret key', 'Explorer', 'Delete',
        ]);
        // Every row has its tinted icon square and a line saying what it does.
        for (const row of rows) {
            expect(row.querySelector('[aria-hidden="true"][data-tone] svg')).toBeTruthy();
        }
        expect(screen.getByRole('button', { name: /^Receive/ }).textContent).toContain('Show this address and its QR to get paid');
    });

    it('runs each row\'s own handler', () => {
        const { handlers, open } = mount();
        const press = (name) => fireEvent.click(screen.getByRole('button', { name }));
        press(/^Receive/);
        press(/^On-chain prefs/);
        press(/^Hide/);
        press(/^Set active/);
        press(/^Secret key/);
        press(/^Explorer/);
        press(/^Delete/);
        expect(handlers.onReceive).toHaveBeenCalledTimes(1);
        expect(handlers.onEditPreferences).toHaveBeenCalledTimes(1);
        expect(handlers.onToggleHidden).toHaveBeenCalledTimes(1);
        expect(handlers.onSetActive).toHaveBeenCalledTimes(1);
        expect(handlers.onShowSecret).toHaveBeenCalledTimes(1);
        expect(handlers.onDelete).toHaveBeenCalledTimes(1);
        expect(open).toHaveBeenCalledWith('https://explorer.example/address/x', '_blank', 'noopener,noreferrer');
        press(/^Edit label/);
        expect(screen.getByRole('textbox', { name: 'Address label' })).toHaveValue('Savings');
    });

    it('draws Delete in the danger tone and every other row in the default tone', () => {
        mount();
        expect(screen.getByRole('button', { name: /^Delete/ })).toHaveAttribute('data-tone', 'danger');
        expect(screen.getByRole('button', { name: /^Receive/ })).toHaveAttribute('data-tone', 'default');
    });

    it('keeps a watch-only Secret key row, off, with the locked reason as its line', () => {
        const { handlers } = mount({ selected: { chainId: 'bitcoin-regtest', address: ADDRESS, label: 'Watch', record: { id: 'a2', source: 'watch-only' } } });
        const row = screen.getByTestId('address-detail-secret-locked');
        expect(row).toHaveAttribute('aria-disabled', 'true');
        const reason = screen.getByText('No key in this wallet');
        expect(row.getAttribute('aria-describedby')).toBe(reason.id);
        fireEvent.click(row);
        expect(handlers.onShowSecret).not.toHaveBeenCalled();
    });

    it('holds Set active and Delete off while one of them runs', () => {
        mount({ detailAction: 'delete' });
        expect(screen.getByRole('button', { name: /^Deleting/ })).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('button', { name: /^Deleting/ })).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('button', { name: /^Set active/ })).toHaveAttribute('aria-disabled', 'true');
    });
});
