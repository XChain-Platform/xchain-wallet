// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A read-only address field (From and the like) shows the whole address when
// it fits its box and trims the middle only when the box is too narrow. The
// width comes from the component's own measuring logic: the overlay box's
// clientWidth against the measured text width, so these tests stub those two
// readings instead of running a browser.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AddressField } from '../../../packages/core/src/ui/AddressField.jsx';
import { truncateAddress } from '../../../packages/core/src/ui/AddressText.jsx';

const ADDRESS = 'bc1q1234567890abcdefghijklmnopqrstuvwxyz';
// Every character measures 10px, so the full address needs 400px.
const CHAR_PX = 10;

afterEach(() => vi.restoreAllMocks());

// The box width is read from the nearest container that declares one, so
// the overlay span inside AddressField takes its host container's width.
function mockMeasurements() {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function width() {
        const host = this.closest?.('[data-fit-width]');
        return host ? Number(host.dataset.fitWidth) : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function bounds() {
        const width = this.hasAttribute('data-address-measure') ? this.textContent.length * CHAR_PX : 0;
        return { width, height: 0, top: 0, right: width, bottom: 0, left: 0, x: 0, y: 0, toJSON() {} };
    });
}

function renderFromField(width) {
    return render(
        <div data-fit-width={String(width)}>
            <AddressField
                label="From"
                icon="addresses"
                value={ADDRESS}
                readOnly
                onChange={() => {}}
                onIconClick={() => {}}
            />
        </div>,
    );
}

function shownAddress(container) {
    const overlay = container.querySelector('[class*="readOnlyValue"]');
    const text = overlay.querySelector(`[aria-label="${ADDRESS}"]`);
    // The hidden measuring span is empty after each measurement.
    return text.firstChild.textContent;
}

describe('<AddressField> read-only width fit', () => {
    it('shows the whole address in a box wide enough for it', () => {
        mockMeasurements();
        const { container } = renderFromField(600);

        expect(shownAddress(container)).toBe(ADDRESS);
        expect(shownAddress(container)).not.toContain('…');
    });

    it('shows the whole address when the box is exactly its width', () => {
        mockMeasurements();
        const { container } = renderFromField(ADDRESS.length * CHAR_PX);

        expect(shownAddress(container)).toBe(ADDRESS);
    });

    it('trims only the middle, keeping equal ends, in a narrow box', () => {
        mockMeasurements();
        const { container } = renderFromField(250);

        const shown = shownAddress(container);
        expect(shown).toContain('…');
        expect(shown.length * CHAR_PX).toBeLessThanOrEqual(250);
        const [head, tail] = shown.split('…');
        expect(head.length).toBe(tail.length);
        expect(ADDRESS.startsWith(head)).toBe(true);
        expect(ADDRESS.endsWith(tail)).toBe(true);
        // As much of the address as fits: one more character each side would not.
        expect((shown.length + 2) * CHAR_PX).toBeGreaterThan(250);
        // Longer than the fixed six-and-six fallback, since the box has room.
        expect(shown.length).toBeGreaterThan(truncateAddress(ADDRESS).length);
    });

    it('keeps the full value in the control and its title whatever the width', () => {
        mockMeasurements();
        renderFromField(120);

        const input = screen.getByLabelText('From');
        expect(input).toHaveValue(ADDRESS);
        expect(input).toHaveAttribute('title', ADDRESS);
    });

    it('leaves an editable address untrimmed: the input holds the full value', () => {
        mockMeasurements();
        const { container } = render(
            <div data-fit-width="120">
                <AddressField label="To" icon="contacts" value={ADDRESS} onChange={() => {}} onIconClick={() => {}} />
            </div>,
        );

        expect(screen.getByLabelText('To')).toHaveValue(ADDRESS);
        expect(container.querySelector('[class*="readOnlyValue"]')).toBeNull();
    });
});
