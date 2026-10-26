// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', () => ({
    useFiatRate: () => ({ rate: 1, fiatCurrency: 'EUR' }),
}));

const { EntryRow } = await import('../../../packages/core/src/shared/routes/History.jsx');

afterEach(() => cleanup());

function renderRow(amount) {
    const entry = {
        key: 'row-bidi',
        action: 'SEND',
        actionIndex: '12',
        blockIndex: 100,
        chainId: 'bitcoin-mainnet',
        address: 'wallet-address',
        source: 'wallet-address',
        raw: { source: 'wallet-address', tick: 'PEPE', amount },
    };
    return render(
        <EntryRow
            entry={entry}
            selected={false}
            showConnector={false}
            onClick={vi.fn()}
            peerCache={{}}
            walletId="wallet-a"
        />,
    ).container;
}

describe('History row amount direction', () => {
    it('keeps the sign with the number in a right-to-left page', () => {
        const node = renderRow('1.5').querySelector('[data-history-amount]');
        expect(node.textContent).toBe('-1.5 PEPE');
        expect(node.getAttribute('dir')).toBe('ltr');
    });
});
