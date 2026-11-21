// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListDetailSplit } from '../../../packages/core/src/shared/components/PanelSplit.jsx';

let boxWidth = 900;
let originalResizeObserver;

function rectFor(element) {
    const measured = element.hasAttribute('data-list-detail');
    const width = measured ? boxWidth : 0;
    const left = measured ? 40 : 0;
    return {
        width,
        height: 600,
        top: 0,
        left,
        right: left + width,
        bottom: 600,
        x: left,
        y: 0,
        toJSON() {},
    };
}

function publishFold(division) {
    globalThis.__xchainNativeFold = { division };
    globalThis.dispatchEvent(new Event('xchain:native-fold'));
}

function Split({ measureRef }) {
    return (
        <ListDetailSplit
            measureRef={measureRef}
            storageKey="fold-test"
            resizeLabel="Resize folded list"
            layoutName="fold-test"
            list={<p>List rows</p>}
            listLabel="Fold list"
            detail={<p>Selected detail</p>}
            detailLabel="Chosen item"
        />
    );
}

beforeEach(() => {
    boxWidth = 900;
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = undefined;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getBoundingClientRect() {
        return rectFor(this);
    });
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    globalThis.ResizeObserver = originalResizeObserver;
    delete globalThis.__xchainNativeFold;
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('PanelSplit fold transitions', () => {
    it('snaps the divider to a vertical fold and restores its preferred width on unfold', () => {
        globalThis.__xchainNativeFold = {
            division: { orientation: 'vertical', x: 510, y: 0 },
        };
        render(<Split />);

        const divider = screen.getByRole('separator', { name: 'Resize folded list' });
        expect(divider).toHaveAttribute('aria-valuenow', '462');
        expect(divider).toHaveAttribute('aria-valuemax', '462');
        expect(screen.getByText('Selected detail')).toBeInTheDocument();

        act(() => publishFold({ orientation: 'none', x: 0, y: 0 }));

        expect(divider).toHaveAttribute('aria-valuenow', '324');
        expect(screen.getByText('Selected detail')).toBeInTheDocument();
    });

    it('keeps the selected detail visible when narrow and returns the list on unfold', () => {
        render(<Split />);
        expect(screen.getByText('List rows')).toBeInTheDocument();
        const detail = screen.getByRole('region', { name: 'Chosen item' });
        expect(detail).toHaveTextContent('Selected detail');

        boxWidth = 500;
        act(() => globalThis.dispatchEvent(new Event('resize')));
        expect(screen.queryByText('List rows')).not.toBeInTheDocument();
        expect(screen.queryByRole('separator', { name: 'Resize folded list' })).not.toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Chosen item' })).toBe(detail);

        boxWidth = 900;
        act(() => globalThis.dispatchEvent(new Event('resize')));
        expect(screen.getByText('List rows')).toBeInTheDocument();
        expect(screen.getByRole('separator', { name: 'Resize folded list' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Chosen item' })).toBe(detail);
    });
});
