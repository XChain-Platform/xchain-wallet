// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An empty list screen reads like the rest of the app: a short title, one
// line of body, and the create action as a button. The phone showed whole
// sentences in bold telling the user to "Use Create dispenser" on a screen
// whose only create control is an unlabelled "+".

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispensersList } from '../../../packages/core/src/shared/routes/DispensersList.jsx';
import { MyLists } from '../../../packages/core/src/shared/routes/MyLists.jsx';

const ADDRESSES = { 'bitcoin-mainnet': [{ id: 'a1', address: 'bc1qexampleaddress000000000000000000000000', source: 'hd' }] };

function mount(node, extra) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        ...extra,
    };
    render(<MessagingProvider shell="web" messaging={messaging}>{node}</MessagingProvider>);
}

afterEach(() => cleanup());

describe('empty list screens offer the create action', () => {
    it('My dispensers', async () => {
        const onCreateDispenser = vi.fn();
        mount(
            <DispensersList walletId="w" onOpenDispenser={() => {}} onBack={() => {}} onCreateDispenser={onCreateDispenser} />,
            { getDispensersForSource: vi.fn().mockResolvedValue({ data: [] }) },
        );
        expect(await screen.findByText('No dispensers yet', {}, { timeout: 10_000 })).toBeTruthy();
        expect(screen.queryByText(/Use Create dispenser/)).toBeNull();
        const buttons = screen.getAllByRole('button', { name: 'Create dispenser' });
        fireEvent.click(buttons[buttons.length - 1]);
        expect(onCreateDispenser).toHaveBeenCalled();
    }, 20_000);

    it('My lists', async () => {
        const onCreateList = vi.fn();
        mount(
            <MyLists walletId="w" onOpenList={() => {}} onBack={() => {}} onCreateList={onCreateList} />,
            { getListsForSource: vi.fn().mockResolvedValue({ data: [] }) },
        );
        expect(await screen.findByText('No lists yet', {}, { timeout: 10_000 })).toBeTruthy();
        expect(screen.queryByText(/Use Create list/)).toBeNull();
        const buttons = screen.getAllByRole('button', { name: 'Create list' });
        fireEvent.click(buttons[buttons.length - 1]);
        expect(onCreateList).toHaveBeenCalled();
    }, 20_000);
});
