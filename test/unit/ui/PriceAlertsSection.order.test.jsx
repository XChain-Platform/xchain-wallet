// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The add-alert form reads as three rows on a phone: the coin, then the
// direction with the price, then Add alert (with Cancel). jsdom has no layout,
// so the rows are pinned by their data-row groups and DOM order.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { PriceAlertForm } from '../../../packages/core/src/shared/components/PriceAlertForm.jsx';

afterEach(() => cleanup());

function rowOf(node) {
    return node.closest('[data-row]');
}

function follows(a, b) {
    return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function expectRows({ coin, onCancel }) {
    const direction = screen.getByRole('combobox', { name: 'Direction' });
    const price = screen.getByRole('textbox', { name: 'Target price' });
    const add = screen.getByRole('button', { name: 'Add alert' });

    const coinRow = rowOf(coin);
    const filterRow = rowOf(direction);
    const actionRow = rowOf(add);

    expect(coinRow?.getAttribute('data-row')).toBe('coin');
    expect(filterRow?.getAttribute('data-row')).toBe('filters');
    expect(actionRow?.getAttribute('data-row')).toBe('action');
    expect(rowOf(price)).toBe(filterRow);
    expect(coinRow).not.toBe(filterRow);
    expect(actionRow).not.toBe(filterRow);

    // The three groups are siblings in coin, filters, action order.
    expect(coinRow.parentElement).toBe(filterRow.parentElement);
    expect(actionRow.parentElement).toBe(filterRow.parentElement);
    const groups = [...coinRow.parentElement.querySelectorAll(':scope > [data-row]')];
    expect(groups.map((g) => g.getAttribute('data-row'))).toEqual(['coin', 'filters', 'action']);

    expect(follows(coin, direction)).toBe(true);
    expect(follows(direction, price)).toBe(true);
    expect(follows(price, add)).toBe(true);

    if (onCancel) {
        const cancel = screen.getByRole('button', { name: 'Cancel' });
        expect(rowOf(cancel)).toBe(actionRow);
        expect(follows(add, cancel)).toBe(true);
    }
}

describe('PriceAlertForm row order', () => {
    it('puts the coin picker, then direction with price, then Add alert in their own rows', () => {
        render(<PriceAlertForm onCreate={vi.fn()} />);
        expectRows({ coin: screen.getByRole('combobox', { name: 'Coin' }) });
    });

    it('keeps Cancel in the action row beside Add alert', () => {
        render(<PriceAlertForm onCreate={vi.fn()} onCancel={vi.fn()} />);
        expectRows({ coin: screen.getByRole('combobox', { name: 'Coin' }), onCancel: true });
    });

    it('gives the locked coin label its own row on the token detail form', () => {
        render(<PriceAlertForm lockedChainId="bitcoin-mainnet" onCreate={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.queryByRole('combobox', { name: 'Coin' })).toBeNull();
        expectRows({ coin: screen.getByText('Bitcoin'), onCancel: true });
    });

    it('keeps each group on its own line at every form width', () => {
        render(<PriceAlertForm onCreate={vi.fn()} />);
        const groups = [...document.querySelectorAll('[data-row]')];
        expect(groups).toHaveLength(3);
        const container = groups[0].parentElement;
        expect(container.style.display).toBe('flex');
        expect(container.style.flexDirection).toBe('column');
        expect(container.style.alignItems).toBe('flex-start');
        for (const group of groups) {
            expect(group.style.flexBasis).toBe('');
        }
    });
});
