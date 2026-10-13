// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    it('shows a middle ellipsis while exposing the full address accessibly', () => {
        render(<AddressText address={ADDRESS} />);

        const address = screen.getByLabelText(ADDRESS);
        expect(address).toHaveTextContent('bc1q12…uvwxyz');
        expect(address).toHaveAttribute('title', ADDRESS);
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

    it('renders the full address when truncation is disabled', () => {
        render(<AddressText address={SHORT_ADDRESS} truncate={false} />);
        expect(screen.getByLabelText(SHORT_ADDRESS)).toHaveTextContent(SHORT_ADDRESS);
    });

    it('splits highlighted addresses into head, middle, and tail without changing their name', () => {
        const { container } = render(<AddressText address={SHORT_ADDRESS} highlight truncate={false} />);
        const value = screen.getByLabelText(SHORT_ADDRESS);
        expect(value.children).toHaveLength(3);
        expect(value.children[0]).toHaveTextContent(SHORT_ADDRESS.slice(0, 6));
        expect(value.children[1]).toHaveTextContent(SHORT_ADDRESS.slice(6, -6));
        expect(value.children[2]).toHaveTextContent(SHORT_ADDRESS.slice(-6));
        expect(container.firstChild).toBe(value);
    });

    it('shows a neutral placeholder for absent addresses', () => {
        const { container } = render(<AddressText address="" size="sm" />);
        expect(container.firstChild).toHaveTextContent('…');
        expect(container.firstChild).not.toHaveAttribute('aria-label');
    });
});
