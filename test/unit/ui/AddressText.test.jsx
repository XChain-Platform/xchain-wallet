// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AddressField } from '../../../packages/core/src/ui/AddressField.jsx';
import { AddressText, truncateAddress } from '../../../packages/core/src/ui/AddressText.jsx';

const ADDRESS = 'bc1q1234567890abcdefghijklmnopqrstuvwxyz';
const SHORT_ADDRESS = 'bc1qabcdefghijklmnopqrstuv';

describe('truncateAddress', () => {
    it('keeps short values intact', () => {
        expect(truncateAddress('bc1q1234567890')).toBe('bc1q1234567890');
    });

    it('keeps both identifying ends of long values', () => {
        expect(truncateAddress(ADDRESS)).toBe('bc1q12…uvwxyz');
    });
});

describe('<AddressText>', () => {
    it('shows one middle ellipsis and exposes the full value on focus, copy, and to screen readers', () => {
        render(<AddressText address={ADDRESS} />);

        const address = screen.getByLabelText(ADDRESS);
        expect(address).toHaveTextContent('bc1q12…uvwxyz');
        expect(address).toHaveAttribute('title', ADDRESS);
        expect(address).toHaveAttribute('tabindex', '0');
        expect(address).toHaveStyle({ whiteSpace: 'nowrap', wordBreak: 'normal' });

        fireEvent.focus(address);
        expect(address).toHaveTextContent(ADDRESS);

        const setData = vi.fn();
        fireEvent.copy(address, { clipboardData: { setData } });
        expect(setData).toHaveBeenCalledWith('text/plain', ADDRESS);

        fireEvent.blur(address);
        expect(address).toHaveTextContent('bc1q12…uvwxyz');
    });
});

describe('<AddressText> inside a control', () => {
    it('is not a second tab stop when a button or link already owns the row', () => {
        render(
            <div>
                <button type="button"><AddressText address={ADDRESS} /></button>
                <a href="#x"><AddressText address={ADDRESS} /></a>
                <div role="menuitem"><AddressText address={ADDRESS} /></div>
                <AddressText address={ADDRESS} />
            </div>,
        );
        const spans = screen.getAllByLabelText(ADDRESS);
        expect(spans.map((el) => el.getAttribute('tabindex'))).toEqual([null, null, null, '0']);
    });
});

describe('<AddressField>', () => {
    it('keeps the full read-only value available behind the middle-ellipsis display', () => {
        render(
            <AddressField
                label="From"
                icon="addresses"
                value={ADDRESS}
                readOnly
                onChange={() => {}}
                onIconClick={() => {}}
            />,
        );

        const input = screen.getByLabelText('From');
        expect(input).toHaveValue(ADDRESS);
        expect(input).toHaveAttribute('title', ADDRESS);
        expect(screen.getByText('bc1q12…uvwxyz').closest('[aria-hidden="true"]')).not.toBeNull();
    });
});

describe('<AddressText> rendering', () => {
    it('truncates long addresses visually while preserving the accessible value', () => {
        render(<AddressText address={SHORT_ADDRESS} />);
        const value = screen.getByLabelText(SHORT_ADDRESS);
        expect(value).toHaveTextContent(`${SHORT_ADDRESS.slice(0, 6)}…${SHORT_ADDRESS.slice(-6)}`);
        expect(value).toHaveAttribute('title', SHORT_ADDRESS);
    });

    it('renders the full address in explicit verification contexts', () => {
        render(<AddressText address={SHORT_ADDRESS} truncate={false} />);
        expect(screen.getByLabelText(SHORT_ADDRESS)).toHaveTextContent(SHORT_ADDRESS);
    });

    it('splits highlighted addresses into head, middle, and tail without changing their name', () => {
        const { container } = render(<AddressText address={SHORT_ADDRESS} highlight />);
        const value = screen.getByLabelText(SHORT_ADDRESS);
        expect(value.children).toHaveLength(3);
        expect(value.children[0]).toHaveTextContent(SHORT_ADDRESS.slice(0, 6));
        expect(value.children[1]).toHaveTextContent('…');
        expect(value.children[2]).toHaveTextContent(SHORT_ADDRESS.slice(-6));
        fireEvent.focus(value);
        expect(value.children[1]).toHaveTextContent(SHORT_ADDRESS.slice(6, -6));
        expect(container.firstChild).toBe(value);
    });

    it('lets a full address wrap instead of clipping it to one line', () => {
        render(<AddressText address={ADDRESS} truncate={false} />);
        const address = screen.getByLabelText(ADDRESS);
        expect(address).toHaveTextContent(ADDRESS);
        expect(address.style.whiteSpace).not.toBe('nowrap');
        expect(address.style.overflowX).toBe('');
        expect(address.style.overflowWrap).toBe('anywhere');
    });

    it('keeps a truncated address on one line', () => {
        render(<AddressText address={ADDRESS} />);
        expect(screen.getByLabelText(ADDRESS).style.whiteSpace).toBe('nowrap');
    });

    it('shows a neutral placeholder for absent addresses', () => {
        const { container } = render(<AddressText address="" size="sm" />);
        expect(container.firstChild).toHaveTextContent('…');
        expect(container.firstChild).not.toHaveAttribute('aria-label');
    });
});
