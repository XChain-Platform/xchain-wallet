// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MultisigBadge } from '../../../packages/core/src/ui/MultisigBadge.jsx';

describe('<MultisigBadge>', () => {
    it.each([
        ['p2sh-multisig', 'Classic', 'P2SH'],
        ['p2wsh-multisig', 'SegWit', 'P2WSH'],
        ['taproot-musig2', 'Taproot', 'MuSig2'],
    ])('renders the %s scheme with a descriptive accessible name', (scheme, label, code) => {
        render(<MultisigBadge threshold={2} cosignerCount={3} scheme={scheme} />);
        const badge = screen.getByRole('img', { name: new RegExp(`2 of 3 multisig.*${code}`) });
        expect(badge).toHaveTextContent('2-of-3');
        expect(badge).toHaveTextContent(label);
        expect(badge).toHaveAttribute('data-scheme', scheme);
        expect(badge).toHaveAttribute('title', badge.getAttribute('aria-label'));
    });

    it('falls back to the raw scheme name with a stable tone', () => {
        render(<MultisigBadge threshold={1} cosignerCount={2} scheme="custom-script" />);
        const badge = screen.getByTestId('multisig-badge');
        expect(badge).toHaveTextContent('custom-script');
        expect(badge).toHaveAccessibleName('1 of 2 multisig (custom-script)');
    });

    it('changes compact sizing through the size prop', () => {
        const { rerender } = render(
            <MultisigBadge threshold={2} cosignerCount={3} scheme="p2wsh-multisig" size="sm" />,
        );
        expect(screen.getByTestId('multisig-badge')).toHaveStyle({ fontSize: '0.7rem' });
        rerender(<MultisigBadge threshold={2} cosignerCount={3} scheme="p2wsh-multisig" size="md" />);
        expect(screen.getByTestId('multisig-badge')).toHaveStyle({ fontSize: '0.78rem' });
    });

    it.each([
        { threshold: 1.5, cosignerCount: 3, scheme: 'p2wsh-multisig' },
        { threshold: 2, cosignerCount: null, scheme: 'p2wsh-multisig' },
        { threshold: 2, cosignerCount: 3, scheme: '' },
    ])('renders nothing for incomplete configuration %#', (props) => {
        const { container } = render(<MultisigBadge {...props} />);
        expect(container).toBeEmptyDOMElement();
    });
});
