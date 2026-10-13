// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AddressText } from '../../../packages/core/src/ui/AddressText.jsx';

const ADDRESS = 'bc1qabcdefghijklmnopqrstuv';

describe('<AddressText>', () => {
    it('truncates long addresses visually while preserving the accessible value', () => {
        render(<AddressText address={ADDRESS} />);
        const value = screen.getByLabelText(ADDRESS);
        expect(value).toHaveTextContent(`${ADDRESS.slice(0, 6)}…${ADDRESS.slice(-6)}`);
        expect(value).toHaveAttribute('title', ADDRESS);
    });

    it('renders the full address when truncation is disabled', () => {
        render(<AddressText address={ADDRESS} truncate={false} />);
        expect(screen.getByLabelText(ADDRESS)).toHaveTextContent(ADDRESS);
    });

    it('splits highlighted addresses into head, middle, and tail without changing their name', () => {
        const { container } = render(<AddressText address={ADDRESS} highlight truncate={false} />);
        const value = screen.getByLabelText(ADDRESS);
        expect(value.children).toHaveLength(3);
        expect(value.children[0]).toHaveTextContent(ADDRESS.slice(0, 6));
        expect(value.children[1]).toHaveTextContent(ADDRESS.slice(6, -6));
        expect(value.children[2]).toHaveTextContent(ADDRESS.slice(-6));
        expect(container.firstChild).toBe(value);
    });

    it('shows a neutral placeholder for absent addresses', () => {
        const { container } = render(<AddressText address="" size="sm" />);
        expect(container.firstChild).toHaveTextContent('…');
        expect(container.firstChild).not.toHaveAttribute('aria-label');
    });
});
