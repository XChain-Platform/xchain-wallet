import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChainBadge } from '../../src/ui/ChainBadge.jsx';
import { defaultRegistry } from '../../src/registry/index.js';

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

    it('renders the chain icon image with the asset URL from branding', () => {
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
