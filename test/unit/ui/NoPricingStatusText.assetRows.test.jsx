// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Asset rows carry no verification status text when the wallet cannot check
// a balance: a row simply shows its amount. A proven or contradicted balance
// keeps its badge, since those verdicts tell the user something to act on.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BalanceList } from '../../../packages/core/src/shared/components/BalanceList.jsx';

afterEach(() => cleanup());

const tokenRow = (tick) => ({
    chainId: 'bitcoin-mainnet',
    coin: 'bitcoin',
    tick,
    kind: 'token',
    displayName: `${tick} token`,
    quantity: '100000000',
    divisibility: 8,
    fiatRate: null,
});

const renderWith = (status) => render(
    <BalanceList
        rows={[tokenRow('PEPE')]}
        verifyMap={{ 'bitcoin-mainnet:PEPE': { status, reason: 'NOT_YET_CHECKPOINTED' } }}
    />,
);

describe('asset rows show no verification status text', () => {
    it('renders no Unverified label on a token row the wallet cannot check', () => {
        renderWith('unavailable');
        const item = screen.getByRole('listitem');
        expect(item.textContent).toContain('PEPE token');
        expect(item.textContent).not.toMatch(/unverified/i);
        expect(item.querySelector('[data-testid="verified-badge"]')).toBeNull();
    });

    it.each([
        ['verified', 'Verified'],
        ['failed', 'Proof failed'],
    ])('keeps the %s badge on a token row', (status, label) => {
        renderWith(status);
        const badge = screen.getByTestId('verified-badge');
        expect(badge.dataset.status).toBe(status);
        expect(badge.textContent).toContain(label);
    });
});
