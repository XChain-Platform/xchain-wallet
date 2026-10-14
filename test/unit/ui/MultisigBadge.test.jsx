// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
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
        expect(screen.getByTestId('multisig-badge')).toHaveStyle({
            height: 'var(--xc-badge-height-sm)',
            fontSize: 'var(--xc-badge-font-size-sm)',
        });
        rerender(<MultisigBadge threshold={2} cosignerCount={3} scheme="p2wsh-multisig" size="md" />);
        expect(screen.getByTestId('multisig-badge')).toHaveStyle({
            height: 'var(--xc-badge-height-md)',
            fontSize: 'var(--xc-badge-font-size-md)',
        });
    });

    it('keeps badge components and count pills on the shared geometry tokens', () => {
        const files = [
            'packages/core/src/ui/ChainBadge.module.css',
            'packages/core/src/ui/VerifiedBadge.jsx',
            'packages/core/src/ui/MultisigBadge.jsx',
            'packages/core/src/shared/components/WatchOnlyBadge.jsx',
            'packages/core/src/shared/components/DispenserBadge.jsx',
            'packages/core/src/shared/components/LeftNav.module.css',
            'packages/core/src/shared/components/BottomTabBar.module.css',
        ];
        const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
        const tokens = readFileSync('packages/core/src/ui/tokens.css', 'utf8');

        for (const token of [
            '--xc-badge-height-sm',
            '--xc-badge-height-md',
            '--xc-badge-radius',
            '--xc-badge-font-size-sm',
            '--xc-badge-font-size-md',
            '--xc-badge-font-weight',
            '--xc-badge-icon-size-sm',
            '--xc-badge-icon-size-md',
            '--xc-badge-gap',
        ]) {
            expect(tokens).toContain(`${token}:`);
            expect(source).toContain(`var(${token})`);
        }

        for (const tone of ['classic', 'segwit', 'taproot']) {
            expect(tokens.match(new RegExp(`--xc-badge-multisig-${tone}-bg:`, 'g'))).toHaveLength(3);
            expect(tokens.match(new RegExp(`--xc-badge-multisig-${tone}-fg:`, 'g'))).toHaveLength(3);
        }
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
