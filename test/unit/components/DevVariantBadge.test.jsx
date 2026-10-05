// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const variantActions = vi.hoisted(() => ({
    setActiveVariant: vi.fn(),
    clearVariantOverride: vi.fn(),
}));

vi.mock('../../../packages/web/src/devVariant.js', () => ({
    ...variantActions,
    THRESHOLD_PX: 600,
}));

import { DevVariantBadge } from '../../../packages/web/src/DevVariantBadge.jsx';

const positionKey = 'xc.devVariantBadge.pos';
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');

function renderBadge(state = { variant: 'small', source: 'auto', viewportPx: 375 }) {
    render(<DevVariantBadge state={state} />);
    return screen.getByRole('status');
}

function setInnerWidth(value) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value });
}

afterEach(() => {
    cleanup();
    window.localStorage.clear();
    variantActions.setActiveVariant.mockReset();
    variantActions.clearVariantOverride.mockReset();
    vi.restoreAllMocks();
    if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    else delete window.innerWidth;
});

describe('DevVariantBadge', () => {
    it('labels and describes an automatically selected variant', () => {
        const badge = renderBadge();

        expect(badge.getAttribute('aria-label')).toBe('Dev variant: small');
        expect(badge.textContent).toContain('small');
        expect(badge.textContent).toContain('auto · 375px');
        expect(screen.getByTitle('Threshold: 600px')).not.toBeNull();
        expect(screen.getByLabelText('Pick variant').value).toBe('__auto');
    });

    it('labels and describes a forced variant', () => {
        const badge = renderBadge({ variant: 'extension', source: 'url', viewportPx: 360 });

        expect(badge.getAttribute('aria-label')).toBe('Dev variant: extension');
        expect(badge.textContent).toContain('extension');
        expect(badge.textContent).toContain('forced · 360px');
        expect(screen.getByLabelText('Pick variant').value).toBe('extension');
    });

    it('clears auto selection and applies a named selection', () => {
        renderBadge({ variant: 'full', source: 'url', viewportPx: 900 });
        const picker = screen.getByLabelText('Pick variant');

        fireEvent.change(picker, { target: { value: '__auto' } });
        expect(variantActions.clearVariantOverride).toHaveBeenCalledTimes(1);

        fireEvent.change(picker, { target: { value: 'sidebar' } });
        expect(variantActions.setActiveVariant).toHaveBeenCalledWith('sidebar');
    });

    it('applies a saved position from local storage', () => {
        window.localStorage.setItem(positionKey, JSON.stringify({ x: 10, y: 20 }));

        const badge = renderBadge();

        expect(badge.style.left).toBe('10px');
        expect(badge.style.top).toBe('20px');
    });

    it.each([
        ['malformed JSON', '{bad'],
        ['non-numeric coordinates', JSON.stringify({ x: '10', y: 20 })],
    ])('ignores a saved position with %s', (_label, savedValue) => {
        window.localStorage.setItem(positionKey, savedValue);

        const badge = renderBadge();

        expect(badge.style.left).toBe('');
        expect(badge.style.top).toBe('');
    });

    it('re-clamps and persists a saved position after viewport resize', () => {
        window.localStorage.setItem(positionKey, JSON.stringify({ x: 700, y: 20 }));
        const badge = renderBadge();
        vi.spyOn(badge, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 40 });
        setInnerWidth(500);

        fireEvent(window, new Event('resize'));

        expect(badge.style.left).toBe('396px');
        expect(badge.style.top).toBe('20px');
        expect(JSON.parse(window.localStorage.getItem(positionKey))).toEqual({ x: 396, y: 20 });
    });
});
