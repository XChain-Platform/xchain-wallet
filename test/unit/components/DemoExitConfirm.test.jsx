// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import {
    DEMO_EXIT_MESSAGE,
    DemoExitConfirm,
} from '../../../packages/core/src/shared/components/DemoExitConfirm.jsx';

function mount(props = {}) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const view = render(
        <DemoExitConfirm
            busy={false}
            error={null}
            onConfirm={onConfirm}
            onCancel={onCancel}
            {...props}
        />,
    );
    return { onConfirm, onCancel, ...view };
}

afterEach(() => cleanup());

describe('DemoExitConfirm', () => {
    it('renders the destructive demo-exit contract', () => {
        mount();

        const dialog = screen.getByRole('dialog', {
            name: 'Exit demo and delete its data?',
        });
        expect(dialog).toHaveTextContent(DEMO_EXIT_MESSAGE);
        expect(screen.getByRole('button', { name: 'Exit demo & wipe' }).className)
            .toMatch(/danger/);
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    });

    it('renders a caller-specific deletion warning instead of the default', () => {
        const message = 'This deletes every wallet saved on this device.';
        mount({ message });

        expect(screen.getByRole('dialog')).toHaveTextContent(message);
        expect(screen.getByRole('dialog')).not.toHaveTextContent(DEMO_EXIT_MESSAGE);
    });

    it('confirms the exit without cancelling it', () => {
        const { onConfirm, onCancel } = mount();

        fireEvent.click(screen.getByRole('button', { name: 'Exit demo & wipe' }));

        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('cancels without confirming from the cancel button', () => {
        const { onConfirm, onCancel } = mount();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('shows failures and prevents every exit while busy', () => {
        const { onConfirm, onCancel } = mount({ busy: true, error: 'Wipe failed' });
        const dialog = screen.getByRole('dialog');

        expect(dialog).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('alert')).toHaveTextContent('Wipe failed');
        expect(screen.getByRole('button', { name: 'Exit demo & wipe' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

        fireEvent.click(dialog);
        fireEvent.keyDown(window, { key: 'Escape' });

        expect(onConfirm).not.toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
    });
});
