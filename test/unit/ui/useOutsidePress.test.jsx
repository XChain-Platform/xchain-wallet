// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, renderHook } from '@testing-library/react';
import { useOutsidePress } from '../../../packages/core/src/ui/useOutsidePress.js';

afterEach(() => {
    document.body.replaceChildren();
});

describe('useOutsidePress', () => {
    it('uses window mousedown by default and ignores every inside ref', () => {
        const first = document.body.appendChild(document.createElement('div'));
        const second = document.body.appendChild(document.createElement('div'));
        const onOutside = vi.fn();
        renderHook(() => useOutsidePress([{ current: first }, { current: second }], onOutside));

        fireEvent.mouseDown(first);
        fireEvent.mouseDown(second);
        expect(onOutside).not.toHaveBeenCalled();

        fireEvent.mouseDown(window);
        expect(onOutside).toHaveBeenCalledOnce();
    });

    it('listens for pointerdown on document when requested', () => {
        const onOutside = vi.fn();
        renderHook(() => useOutsidePress([], onOutside, {
            events: ['pointerdown'],
            target: 'document',
        }));

        fireEvent.pointerDown(window);
        expect(onOutside).not.toHaveBeenCalled();
        fireEvent.pointerDown(document);
        expect(onOutside).toHaveBeenCalledOnce();
    });

    it('supports capture listeners', () => {
        const outside = document.body.appendChild(document.createElement('button'));
        outside.addEventListener('mousedown', (event) => event.stopPropagation());
        const onOutside = vi.fn();
        renderHook(() => useOutsidePress([], onOutside, { target: 'document', capture: true }));

        fireEvent.mouseDown(outside);
        expect(onOutside).toHaveBeenCalledOnce();
    });

    it('registers only while enabled', () => {
        const onOutside = vi.fn();
        const hook = renderHook(
            ({ enabled }) => useOutsidePress([], onOutside, { enabled }),
            { initialProps: { enabled: false } },
        );

        fireEvent.mouseDown(window);
        expect(onOutside).not.toHaveBeenCalled();
        hook.rerender({ enabled: true });
        fireEvent.mouseDown(window);
        expect(onOutside).toHaveBeenCalledOnce();
        hook.rerender({ enabled: false });
        fireEvent.mouseDown(window);
        expect(onOutside).toHaveBeenCalledOnce();
    });
});
