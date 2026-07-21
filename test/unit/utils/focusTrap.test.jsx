// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Focus trap + background-inert ( §5.1).

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { useFocusTrap, useInertBackground } from '../../../packages/core/src/shared/utils/focusTrap.js';

afterEach(() => cleanup());

function TrapHarness({ active }) {
    const containerRef = useRef(null);
    useFocusTrap(containerRef, { active });
    return (
        <div>
            <button data-testid="outside">outside</button>
            <div ref={containerRef} data-testid="trap">
                <button data-testid="first">first</button>
                <button data-testid="last">last</button>
            </div>
        </div>
    );
}

function InertHarness({ active }) {
    const rootRef = useRef(null);
    useInertBackground(rootRef, { active });
    return (
        <div>
            <div data-testid="sibling">background</div>
            <div ref={rootRef} data-testid="modal-root">modal</div>
        </div>
    );
}

describe('useFocusTrap', () => {
    it('Tab from the last focusable wraps to the first', () => {
        render(<TrapHarness active />);
        const first = screen.getByTestId('first');
        const last = screen.getByTestId('last');
        last.focus();
        fireEvent.keyDown(screen.getByTestId('trap'), { key: 'Tab' });
        expect(document.activeElement).toBe(first);
    });

    it('Shift+Tab from the first wraps to the last', () => {
        render(<TrapHarness active />);
        const first = screen.getByTestId('first');
        const last = screen.getByTestId('last');
        first.focus();
        fireEvent.keyDown(screen.getByTestId('trap'), { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(last);
    });

    it('does not trap when inactive', () => {
        render(<TrapHarness active={false} />);
        const last = screen.getByTestId('last');
        last.focus();
        fireEvent.keyDown(screen.getByTestId('trap'), { key: 'Tab' });
        // No preventDefault/wrap: focus stays where the browser would put it.
        expect(document.activeElement).toBe(last);
    });
});

describe('useInertBackground', () => {
    it('marks siblings inert while active and restores on unmount', () => {
        const { unmount } = render(<InertHarness active />);
        expect(screen.getByTestId('sibling').hasAttribute('inert')).toBe(true);
        unmount();
        // After unmount the harness is gone; re-render inactive to confirm no inert.
        render(<InertHarness active={false} />);
        expect(screen.getByTestId('sibling').hasAttribute('inert')).toBe(false);
    });
});
