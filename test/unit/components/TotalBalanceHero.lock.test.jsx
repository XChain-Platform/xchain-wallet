// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The extension popup and side panel have no header, so the hero is where
// their lock button lives. Before this they had none: a wallet left open in
// a docked side panel could be locked only by a shortcut, the palette or the
// idle timer. Web and desktop lock from their header and pass nothing here,
// so the hero must stay without one for them.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TotalBalanceHero } from '../../../packages/core/src/shared/components/TotalBalanceHero.jsx';

afterEach(cleanup);

function renderHero(props) {
    const messaging = { getSettings: vi.fn(async () => ({})) };
    return render(
        <MessagingProvider shell="popup" messaging={messaging}>
            <TotalBalanceHero rows={[]} walletId="w1" networkFilter="all" {...props} />
        </MessagingProvider>,
    );
}

describe('balance hero lock button', () => {
    it('is absent when the shell locks from its own header', () => {
        renderHero({});
        expect(screen.queryByRole('button', { name: 'Lock wallet' })).toBeNull();
    });

    it('locks the wallet when a headerless shell passes onLockWallet', () => {
        const onLockWallet = vi.fn();
        renderHero({ onLockWallet });
        fireEvent.click(screen.getByRole('button', { name: 'Lock wallet' }));
        expect(onLockWallet).toHaveBeenCalledTimes(1);
    });
});
