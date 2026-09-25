// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// regression (xchain-wallet#57): Home's hero said "Total balance" while its
// rows hold only the active address on each chain, so a wallet with funds on
// other addresses showed a fraction of them under a label that read as the
// whole wallet. The hero names what it sums.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TotalBalanceHero } from '../../../packages/core/src/shared/components/TotalBalanceHero.jsx';

describe('Home balance hero label', () => {
    it('labels the figure as the active address balance, not a wallet total', () => {
        const messaging = { getSettings: vi.fn(async () => ({})) };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TotalBalanceHero rows={[]} walletId="w1" networkFilter="all" />
            </MessagingProvider>,
        );
        expect(screen.getByRole('region', { name: 'Active address balance' })).toBeTruthy();
        expect(screen.queryByText(/Total balance/)).toBeNull();
    });
});
