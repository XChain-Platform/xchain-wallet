// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// NoticeModal and ConfirmModal dismissal, label and variant contract.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@xchain-wallet/core/ui', async () => {
    const React = await import('react');
    return {
        Button: ({ variant, onClick, children, disabled, loading }) =>
            React.createElement('button', {
                'data-variant': variant,
                'aria-busy': loading ? 'true' : 'false',
                disabled: disabled || loading,
                onClick,
            }, children),
    };
});

import { NoticeModal } from '../../../../packages/core/src/shared/components/NoticeModal.jsx';
import { ConfirmModal } from '../../../../packages/core/src/shared/components/ConfirmModal.jsx';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('NoticeModal', () => {
    const setup = (props = {}) => {
        const onClose = vi.fn();
        const view = render(<NoticeModal title="Sent" onClose={onClose} {...props} />);
        return { onClose, ...view };
    };

    it('exposes a modal dialog labelled by the title', () => {
        setup();
        const dialog = screen.getByRole('dialog');
        const title = screen.getByText('Sent');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
        expect(dialog.getAttribute('aria-describedby')).toBeNull();
    });

    it('ties the optional detail to the dialog description', () => {
        setup({ message: 'Message went out' });
        expect(screen.getByRole('dialog').getAttribute('aria-describedby'))
            .toBe(screen.getByText('Message went out').id);
    });

    it('renders the message paragraph only when given', () => {
        const first = setup({ message: 'Message went out' });
        expect(screen.getByText('Message went out').tagName).toBe('P');
        first.unmount();
        const second = setup();
        expect(second.container.querySelectorAll('p')).toHaveLength(1);
    });

    it('defaults the button label to OK and honours confirmLabel', () => {
        const first = setup();
        expect(screen.getByRole('button').textContent).toBe('OK');
        first.unmount();
        setup({ confirmLabel: 'Done' });
        expect(screen.getByRole('button').textContent).toBe('Done');
    });

    it('calls onClose once from the button', () => {
        const { onClose } = setup();
        fireEvent.click(screen.getByRole('button'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on an overlay click but not a panel click', () => {
        const { onClose } = setup();
        fireEvent.click(screen.getByText('Sent'));
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('dialog'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape only while mounted', () => {
        const { onClose, unmount } = setup();
        fireEvent.keyDown(window, { key: 'Enter' });
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
        unmount();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps background content inert while mounted', () => {
        const onClose = vi.fn();
        const view = render(
            <>
                <button type="button">Outside</button>
                <NoticeModal title="Sent" onClose={onClose} />
            </>,
        );
        expect(screen.getByText('Outside').hasAttribute('inert')).toBe(true);
        view.unmount();
    });
});

describe('ConfirmModal', () => {
    const setup = (props = {}) => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        const view = render(<ConfirmModal title="Delete?" onConfirm={onConfirm} onCancel={onCancel} {...props} />);
        return { onConfirm, onCancel, ...view };
    };

    it('defaults labels to Confirm and Cancel', () => {
        setup();
        expect(screen.getByText('Confirm')).toBeTruthy();
        expect(screen.getByText('Cancel')).toBeTruthy();
    });

    it('honours label overrides', () => {
        setup({ confirmLabel: 'Delete', cancelLabel: 'Keep' });
        expect(screen.getByText('Delete')).toBeTruthy();
        expect(screen.getByText('Keep')).toBeTruthy();
        expect(screen.queryByText('Confirm')).toBeNull();
        expect(screen.queryByText('Cancel')).toBeNull();
    });

    it('confirm button calls onConfirm only', () => {
        const { onConfirm, onCancel } = setup();
        fireEvent.click(screen.getByText('Confirm'));
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('cancel button calls onCancel only', () => {
        const { onConfirm, onCancel } = setup();
        fireEvent.click(screen.getByText('Cancel'));
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('overlay click calls onCancel only', () => {
        const { onConfirm, onCancel } = setup();
        fireEvent.click(screen.getByRole('dialog'));
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('Escape calls onCancel and never onConfirm', () => {
        const { onConfirm, onCancel } = setup();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('cycles keyboard focus between its two actions', () => {
        setup();
        const cancel = screen.getByText('Cancel');
        const confirm = screen.getByText('Confirm');
        confirm.focus();
        fireEvent.keyDown(confirm, { key: 'Tab' });
        expect(document.activeElement).toBe(cancel);
        fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(confirm);
    });

    it('uses visible content for its accessible name and description', () => {
        setup({ message: 'This cannot be undone.' });
        const dialog = screen.getByRole('dialog');
        expect(dialog.getAttribute('aria-labelledby')).toBe(screen.getByText('Delete?').id);
        expect(dialog.getAttribute('aria-describedby')).toBe(screen.getByText('This cannot be undone.').id);
    });

    it('styles cancel secondary and confirm primary', () => {
        setup();
        expect(screen.getByText('Cancel').dataset.variant).toBe('secondary');
        expect(screen.getByText('Confirm').dataset.variant).toBe('primary');
    });

    it('turns the confirm variant to danger when danger', () => {
        setup({ danger: true });
        expect(screen.getByText('Cancel').dataset.variant).toBe('secondary');
        expect(screen.getByText('Confirm').dataset.variant).toBe('danger');
    });

    it('shows an error and keeps both exits disabled while confirmation is busy', () => {
        const { onCancel } = setup({ busy: true, error: 'Wipe failed' });
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('alert')).toHaveTextContent('Wipe failed');
        expect(screen.getByText('Cancel')).toBeDisabled();
        expect(screen.getByText('Confirm')).toBeDisabled();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onCancel).not.toHaveBeenCalled();
    });
});
