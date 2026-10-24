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

describe('History row with an amount that is not a number', () => {
    it.each([
        ['an object', { x: 1 }],
        ['NaN text', 'NaN'],
        ['Infinity text', 'Infinity'],
        ['a non-finite number', Number.NaN],
    ])('prints a placeholder for %s', (_label, amount) => {
        const container = renderRow(amount);
        const text = container.textContent;
        expect(text).not.toMatch(/object Object|NaN|Infinity/);
        expect(container.querySelector('[data-history-amount]').textContent).toBe('Not available');
    });

    it('still prints a plain decimal', () => {
        expect(renderRow('1e-7').querySelector('[data-history-amount]').textContent).toBe('-0.0000001 PEPE');
    });
});
