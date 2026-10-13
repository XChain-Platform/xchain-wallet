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
        fireEvent.click(screen.getByRole('button', { name: 'Show 1 hidden collectible' }));
        fireEvent.click(screen.getByRole('button', { name: 'Unpin LONGART' }));
        expect(onTogglePin).toHaveBeenCalledWith('bitcoin-regtest:LONGART', false);
        expect(screen.getByRole('list', { name: 'Hidden collectibles' })).toBeTruthy();
    });

    it('defines bounded phone and desktop grids and preserves long names', () => {
        const css = readFileSync(
            'packages/core/src/shared/components/CollectiblesView.module.css',
            'utf8',
        );

        expect(css).toMatch(/minmax\(min\(9rem, 100%\), 1fr\)/);
        expect(css).toMatch(/@media \(min-width: 48rem\)[\s\S]*minmax\(10rem, 12rem\)/);
        expect(css).toMatch(/overflow-wrap: break-word/);
        expect(css).toMatch(/word-break: normal/);
        expect(css).not.toMatch(/-webkit-line-clamp/);
    });
});
