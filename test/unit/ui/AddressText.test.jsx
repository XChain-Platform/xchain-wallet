// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AddressField } from '../../../packages/core/src/ui/AddressField.jsx';
import { AddressText, truncateAddress } from '../../../packages/core/src/ui/AddressText.jsx';

const ADDRESS = 'bc1q1234567890abcdefghijklmnopqrstuvwxyz';

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
