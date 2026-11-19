// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Keep collectible navigation and preference controls as separate native
// buttons while preserving artwork and a readable broken-image identity.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { tokenInfoByTick } = vi.hoisted(() => ({ tokenInfoByTick: new Map() }));

vi.mock('../../../packages/core/src/shared/hooks/useTokenInfo.js', () => ({
    useTokenInfo: ({ tick }) => tokenInfoByTick.get(tick) || null,
}));

import { CollectiblesView } from '../../../packages/core/src/shared/components/CollectiblesView.jsx';
import { TickerIcon } from '../../../packages/core/src/shared/components/TickerIcon.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const LONG_NAME = 'A collectible name with oneuninterruptedwordthatcannotfitonasinglecard';
const ART_URL = 'https://assets.example/collectible.png';
const ROW = {
    chainId: 'bitcoin-regtest',
    tick: 'LONGART',
    kind: 'token',
    displayName: LONG_NAME,
    divisibility: 0,
    fiatRate: null,
    quantity: '1',
    imageUrl: ART_URL,
};

afterEach(() => {
    cleanup();
    tokenInfoByTick.clear();
});

describe('CollectiblesView cards', () => {
    it('falls back from broken artwork and keeps actions separate from navigation', () => {
        const onSelectToken = vi.fn();
        const onTogglePin = vi.fn();
        const onToggleHide = vi.fn();
        render(
            <CollectiblesView
                rows={[ROW]}
                onSelectToken={onSelectToken}
                onTogglePin={onTogglePin}
                onToggleHide={onToggleHide}
            />,
        );

        const open = screen.getByRole('button', { name: `Open ${LONG_NAME} details` });
        const pin = screen.getByRole('button', { name: 'Pin LONGART' });
        const hide = screen.getByRole('button', { name: 'Hide LONGART' });
        const artwork = document.querySelector(`img[src="${ART_URL}"]`);
        expect(artwork).toHaveAttribute('width', '192');
        expect(artwork).toHaveAttribute('height', '192');
        const chainOverlay = [...document.querySelectorAll('img')]
            .find((image) => image !== artwork);
        expect(chainOverlay).toHaveAttribute('width', '20');
        expect(chainOverlay).toHaveAttribute('height', '20');
        expect(open.querySelector('button')).toBeNull();
        expect(pin.tagName).toBe('BUTTON');
        expect(hide.tagName).toBe('BUTTON');

        fireEvent.click(pin);
        fireEvent.click(hide);
        expect(onTogglePin).toHaveBeenCalledWith('bitcoin-regtest:LONGART', true);
        expect(onToggleHide).toHaveBeenCalledWith('bitcoin-regtest:LONGART', true);
        expect(onSelectToken).not.toHaveBeenCalled();

        fireEvent.click(open);
        expect(onSelectToken).toHaveBeenCalledWith(expect.objectContaining({ imageUrl: ART_URL }));

        fireEvent.error(document.querySelector(`img[src="${ART_URL}"]`));
        expect(document.querySelector(`img[src="${ART_URL}"]`)).toBeNull();
        expect(screen.getByText('LO')).toBeTruthy();
        expect(screen.getByTitle(LONG_NAME).textContent).toBe(LONG_NAME);
    });

    it('keeps the pin state and empty-list escape hatch for hidden collectibles', () => {
        const onTogglePin = vi.fn();
        render(
            <CollectiblesView
                rows={[ROW]}
                pinnedKeys={new Set(['bitcoin-regtest:LONGART'])}
                hiddenKeys={new Set(['bitcoin-regtest:LONGART'])}
                onTogglePin={onTogglePin}
            />,
        );

        expect(screen.queryByText('No collectibles yet')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Show 1 Hidden Collectible' }));
        fireEvent.click(screen.getByRole('button', { name: 'Unpin LONGART' }));
        expect(onTogglePin).toHaveBeenCalledWith('bitcoin-regtest:LONGART', false);
        expect(screen.getByRole('list', { name: 'Hidden collectibles' })).toBeTruthy();
    });

    it('builds the card and the hidden toggle on the shared Button base', () => {
        render(
            <CollectiblesView
                rows={[ROW, { ...ROW, tick: 'HIDDENART', displayName: 'Hidden art' }]}
                hiddenKeys={new Set(['bitcoin-regtest:HIDDENART'])}
                onSelectToken={vi.fn()}
            />,
        );

        const open = screen.getByRole('button', { name: /open/i });
        expect(open.className.split(' ')).toContain(buttonStyles.btn);
        const toggle = screen.getByRole('button', { name: 'Show 1 Hidden Collectible' });
        expect(toggle.className.split(' ')).toContain(buttonStyles.btn);
    });

    it('defines bounded phone and desktop grids and preserves long names', () => {
        const css = readFileSync(
            'packages/core/src/shared/components/CollectiblesView.module.css',
            'utf8',
        );

        expect(css).toMatch(/minmax\(min\(5\.75rem, 100%\), 1fr\)/);
        expect(css).toMatch(/@media \(min-width: 48rem\)[\s\S]*minmax\(7\.5rem, 9rem\)/);
        expect(css).toMatch(/overflow-wrap: break-word/);
        expect(css).toMatch(/word-break: normal/);
        expect(css).not.toMatch(/-webkit-line-clamp/);
    });

    it('puts Home NFTs three across below 31rem and phone-sized tiles beyond', () => {
        const css = readFileSync(
            'packages/core/src/shared/components/CollectiblesView.module.css',
            'utf8',
        );
        const rem = 16;
        // Phone, Pixel, large phone and the 480px popup: the container is the
        // viewport less the two page gutters (space-4 = 1rem each), under 31rem.
        const gap = 8;
        for (const viewport of [320, 360, 412, 480]) {
            const container = viewport - 2 * rem;
            expect(container).toBeLessThan(31 * rem);
        }
        expect(css).toMatch(/\.wrap\[data-size='large'\] \{\s*container-type: inline-size;/);
        expect(css).toMatch(/\.wrap\[data-size='large'\] \.grid \{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
        const wide = css.match(/@container \(min-width: 31rem\) \{\s*\.wrap\[data-size='large'\] \.grid \{\s*grid-template-columns: repeat\(auto-fill, minmax\(([\d.]+)rem, ([\d.]+)rem\)\);/);
        expect(wide).not.toBeNull();
        const [minTile, maxTile] = [Number(wide[1]) * rem, Number(wide[2]) * rem];

        // A phone three-across tile at 320 to 412 (gutters 2 x 16px, 2 gaps).
        const phoneTile = (viewport) => (viewport - 2 * rem - 2 * gap) / 3;
        const reference = phoneTile(360);
        for (const viewport of [320, 360, 412]) {
            expect(phoneTile(viewport)).toBeGreaterThanOrEqual(reference * 0.8 - 8);
        }
        // Wide containers: tiles stay within 20 percent of the 360 phone tile.
        expect(minTile).toBeGreaterThanOrEqual(reference * 0.8);
        expect(maxTile).toBeLessThanOrEqual(reference * 1.2);
        // Tap target: even the smallest tile is above the 44px minimum.
        expect(minTile).toBeGreaterThanOrEqual(44);

        // Columns that fit at 1280 and 1920 desktop (sidebar-less worst case
        // of a 40rem list still beats three; full width gives many more).
        const columns = (container) => Math.floor((container + gap) / (minTile + gap));
        expect(columns(31 * rem)).toBeGreaterThanOrEqual(4);
        expect(columns(1280 - 2 * rem)).toBeGreaterThan(3);
        expect(columns(1920 - 2 * rem)).toBeGreaterThan(columns(1280 - 2 * rem));
    });

    it('leaves the Settings grid on its own bounded columns', () => {
        const css = readFileSync(
            'packages/core/src/shared/components/CollectiblesView.module.css',
            'utf8',
        );
        expect(css).toMatch(/\.grid \{[^}]*minmax\(min\(5\.75rem, 100%\), 1fr\)/);
        // The container and the three-across rule are scoped to the large size.
        expect(css).not.toMatch(/\n\.grid \{[^}]*container-type/);
        expect(css).not.toMatch(/\n\.grid \{[^}]*repeat\(3,/);
    });

    it('keeps the name on one line with an ellipsis only where the grid is large', () => {
        const css = readFileSync(
            'packages/core/src/shared/components/CollectiblesView.module.css',
            'utf8',
        );
        expect(css).toMatch(/\.wrap\[data-size='large'\] \.name \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis/);
    });

    it('stacks the ticker directly under the name with no reserved line', () => {
        const css = readFileSync(
            'packages/core/src/shared/components/CollectiblesView.module.css',
            'utf8',
        );
        const nameRule = css.match(/\n\.name \{([^}]*)\}/);
        expect(nameRule).not.toBeNull();
        expect(nameRule[1]).not.toMatch(/min-height/);

        render(<CollectiblesView rows={[{ ...ROW, displayName: 'Short' }]} onSelectToken={vi.fn()} />);
        const name = screen.getByText('Short');
        expect(name.nextElementSibling).toHaveTextContent('LONGART');
    });

    it('offers a smaller decode candidate for native ticker icons', () => {
        const { container } = render(
            <TickerIcon chainId="bitcoin-mainnet" tick="BTC" size={32} />,
        );

        // A legacy size of 32 renders in the 40px list avatar context, so the
        // image declares the rendered size, not the requested one.
        const icon = container.querySelector('img');
        expect(icon).toHaveAttribute('width', '40');
        expect(icon).toHaveAttribute('height', '40');
        expect(icon).toHaveAttribute('sizes', '40px');
        expect(icon.getAttribute('srcset')).toMatch(/bitcoin-mainnet-icon-20\.png.*144w/);
        expect(icon.getAttribute('srcset')).toMatch(/bitcoin-mainnet-500\.png.*500w/);
    });
});
