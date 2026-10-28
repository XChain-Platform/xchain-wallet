// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Device-pass fixes: one search-and-filter toolbar for every list screen, one
// icon for Dispensers, the donation settings as one flat card per chain, the
// camera explainer as a card, and the reachability notice as a StatusMessage.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ListToolbar } from '../../../packages/core/src/shared/components/ListToolbar.jsx';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const route = (name) => read(`packages/core/src/shared/routes/${name}.jsx`);

afterEach(() => cleanup());

describe('ListToolbar', () => {
    it('renders the search box first and each filter in its own equal-share field', () => {
        const onQueryChange = vi.fn();
        render(
            <ListToolbar query="" onQueryChange={onQueryChange} searchLabel="Search things">
                <select aria-label="Filter one" />
                <select aria-label="Filter two" />
            </ListToolbar>,
        );
        const search = screen.getByRole('searchbox', { name: 'Search things' });
        const toolbar = search.closest('div[class*="toolbar"]');
        const fields = Array.from(toolbar.children);
        expect(fields).toHaveLength(3);
        expect(fields[0].contains(search)).toBe(true);
        expect(fields[1].contains(screen.getByLabelText('Filter one'))).toBe(true);
        expect(fields[2].contains(screen.getByLabelText('Filter two'))).toBe(true);
        fireEvent.change(search, { target: { value: 'abc' } });
        expect(onQueryChange).toHaveBeenCalledWith('abc');
    });
});

describe('list screens share one toolbar', () => {
    it.each(['DispensersList', 'ContactsList', 'MyLists', 'MessagingInbox'])('%s uses ListToolbar', (name) => {
        const source = route(name);
        expect(source).toMatch(/<ListToolbar\b/);
        expect(source).not.toMatch(/type="search"/);
    });
});

describe('Dispensers icon', () => {
    it('keeps the menu icon in the left navigation', () => {
        expect(read('packages/core/src/shared/components/LeftNav.jsx'))
            .toMatch(/dispensers-list[^\n]*Icon\.DollarIcon/);
    });
});

describe('Automatic donation system settings layout', () => {
    const source = read('packages/core/src/shared/components/settings/AdsSection.jsx');
    const css = read('packages/core/src/shared/components/settings/AdsSection.module.css');

    it('draws one card per chain from the shared card class and no inner tiles', () => {
        expect(css).toMatch(/\.chain\s*\{[^}]*composes:\s*card from '\.\.\/\.\.\/\.\.\/ui\/Card\.module\.css'/);
        expect(source).not.toMatch(/ROW\b/);
        expect(css).not.toMatch(/border:/);
    });

    it('shows the donation address in the shared Input like the other fields', () => {
        expect(source.match(/<Input\b[^>]*\n?[^>]*readOnly/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
        expect(source).not.toMatch(/width: 140/);
    });
});

describe('camera explainer', () => {
    it('is a card, not a flat grey panel', () => {
        const css = read('packages/core/src/ui/QrScanner.module.css');
        expect(css).toMatch(/\.rationale\s*\{[^}]*composes:\s*card from '\.\/Card\.module\.css'/);
        const source = read('packages/core/src/ui/QrScanner.jsx');
        expect(source).toMatch(/data-testid="qr-scanner-camera-rationale"\s+className=\{styles\.rationale\}/);
    });
});

describe('reachability notice', () => {
    it('renders through StatusMessage with the warning and error tones', () => {
        const source = read('packages/core/src/shared/components/ReachabilityBanner.jsx');
        expect(source).toMatch(/<StatusMessage\b/);
        expect(source).toMatch(/overall === 'offline' \? 'error' : 'warning'/);
    });
});
