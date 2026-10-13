// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// UndoSendToast is props-only: each status renders as specified, a
// rerender changes the countdown text, and Cancel calls onCancel once.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { UndoSendToast } from '../../../packages/core/src/shared/components/UndoSendToast.jsx';

afterEach(cleanup);

describe('UndoSendToast', () => {
    it('counting renders the live status and a Cancel button', () => {
        render(<UndoSendToast status="counting" remaining={5} onCancel={() => {}} />);
        const status = screen.getByRole('status');
        expect(status.textContent).toBe('Sending in 5 s');
        expect(status.getAttribute('aria-live')).toBe('polite');
        expect(screen.getAllByRole('status')).toHaveLength(1);
        const btn = screen.getByRole('button', { name: 'Cancel' });
        expect(btn.getAttribute('type')).toBe('button');
    });

    it('cancelled renders the status text with no button', () => {
        render(<UndoSendToast status="cancelled" remaining={0} onCancel={() => {}} />);
        expect(screen.getByRole('status').textContent).toBe('Send cancelled');
        expect(screen.queryByRole('button')).toBeNull();
    });

    it.each(['idle', 'elapsed', 'bogus', undefined])('%s renders nothing', (s) => {
        const { container } = render(<UndoSendToast status={s} remaining={3} onCancel={() => {}} />);
        expect(container.innerHTML).toBe('');
    });

    it('a rerender from 5 to 4 changes the text', () => {
        const { rerender } = render(<UndoSendToast status="counting" remaining={5} />);
        expect(screen.getByRole('status').textContent).toBe('Sending in 5 s');
        rerender(<UndoSendToast status="counting" remaining={4} />);
        expect(screen.getByRole('status').textContent).toBe('Sending in 4 s');
    });

    it('a click on Cancel calls onCancel exactly once', () => {
        const onCancel = vi.fn();
        render(<UndoSendToast status="counting" remaining={5} onCancel={onCancel} />);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('a click with no onCancel does not throw', () => {
        render(<UndoSendToast status="counting" remaining={5} />);
        expect(() => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))).not.toThrow();
    });
});
