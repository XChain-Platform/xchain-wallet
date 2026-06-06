// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChainBadge } from '../../../packages/core/src/ui/ChainBadge.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

describe('<ChainBadge>', () => {
    const reg = defaultRegistry();

    it('renders the descriptor display name for mainnet without network suffix', () => {
        const d = reg.get('bitcoin-mainnet');
        render(<ChainBadge descriptor={d} />);
        expect(screen.getByText('Bitcoin')).toBeInTheDocument();
        // Mainnet kind intentionally elided.
        expect(screen.queryByText(/mainnet/i)).toBeNull();
    });

    it('surfaces the network kind on non-mainnet descriptors', () => {
        const d = reg.get('bitcoin-regtest');
        render(<ChainBadge descriptor={d} />);
        expect(screen.getByText(/regtest/i)).toBeInTheDocument();
    });

    it('renders the chain icon image with the tick URL from branding', () => {
        const d = reg.get('dogecoin-mainnet');
        const { container } = render(<ChainBadge descriptor={d} />);
        const img = container.querySelector('img');
        expect(img).not.toBeNull();
        expect(img.getAttribute('src')).toMatch(/dogecoin-mainnet-icon-20\.png/);
    });

    it('applies descriptor.color via the --chain-color CSS custom property', () => {
        const d = reg.get('bitcoin-mainnet');
        const { container } = render(<ChainBadge descriptor={d} />);
        const root = container.firstChild;
        expect(root.getAttribute('style')).toContain('#F7931A');
    });

    it('hides the name when showName={false}', () => {
        const d = reg.get('litecoin-mainnet');
        render(<ChainBadge descriptor={d} showName={false} />);
        expect(screen.queryByText('Litecoin')).toBeNull();
    });
});
