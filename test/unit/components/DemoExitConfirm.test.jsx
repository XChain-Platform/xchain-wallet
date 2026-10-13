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
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import {
    DEMO_EXIT_MESSAGE,
    DemoExitConfirm,
} from '../../../packages/core/src/shared/components/DemoExitConfirm.jsx';

afterEach(cleanup);

function setup(props = {}) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
        <DemoExitConfirm
            busy={false}
            error={null}
            onConfirm={onConfirm}
            onCancel={onCancel}
            {...props}
        />,
    );
    return { onConfirm, onCancel };
}

describe('DemoExitConfirm', () => {
    it('renders the shared destructive warning as an accessible danger dialog', () => {
        setup();

        const dialog = screen.getByRole('dialog', { name: 'Exit demo and delete its data?' });
        expect(dialog).toHaveAccessibleDescription(DEMO_EXIT_MESSAGE);
        expect(dialog).toHaveTextContent('sample accounts, addresses, and history');
        expect(within(dialog).getByRole('button', { name: 'Exit demo & wipe' }).className)
            .toMatch(/danger/);
    });

    it('delegates confirm and cancel actions to their respective callbacks', () => {
        const { onConfirm, onCancel } = setup();
        const dialog = screen.getByRole('dialog');

        fireEvent.click(within(dialog).getByRole('button', { name: 'Exit demo & wipe' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('locks every exit while busy and displays the failure reason', () => {
        const { onConfirm, onCancel } = setup({ busy: true, error: 'Could not clear local data' });
        const dialog = screen.getByRole('dialog');
        const confirm = within(dialog).getByRole('button', { name: 'Exit demo & wipe' });
        const cancel = within(dialog).getByRole('button', { name: 'Cancel' });

        expect(dialog).toHaveAttribute('aria-busy', 'true');
        expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not clear local data');
        expect(confirm).toBeDisabled();
        expect(cancel).toBeDisabled();

        fireEvent.click(confirm);
        fireEvent.click(cancel);
        fireEvent.click(dialog);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onConfirm).not.toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('uses a caller-specific warning in place of the default message', () => {
        setup({ message: 'Delete every wallet saved on this device?' });

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAccessibleDescription('Delete every wallet saved on this device?');
        expect(dialog).not.toHaveTextContent(DEMO_EXIT_MESSAGE);
    });
});
