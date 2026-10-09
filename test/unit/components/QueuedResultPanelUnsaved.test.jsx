// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueuedResultPanel } from '../../../packages/core/src/shared/components/QueuedResultPanel.jsx';
import {
    SIGNED_NOT_BROADCAST_MESSAGE,
    SIGNED_NOT_BROADCAST_UNSAVED_WARNING,
} from '../../../packages/core/src/shared/utils/submitFailureMessage.js';

afterEach(() => cleanup());

describe('QueuedResultPanel unsaved warning', () => {
    it('does not render an alert when unsaved is absent or false', () => {
        const { rerender } = render(<QueuedResultPanel onDone={() => {}} />);
        expect(screen.queryByRole('alert')).toBeNull();

        rerender(<QueuedResultPanel onDone={() => {}} unsaved={false} />);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('renders the unsaved warning as exactly one alert', () => {
        render(<QueuedResultPanel onDone={() => {}} unsaved />);
        const alerts = screen.getAllByRole('alert');
        expect(alerts.length).toBe(1);
        expect(alerts[0].textContent).toBe(SIGNED_NOT_BROADCAST_UNSAVED_WARNING);
    });

    it('keeps the hint, status and single Done button beside the warning', () => {
        render(<QueuedResultPanel onDone={() => {}} unsaved />);
        expect(screen.getByText(/signed but couldn't reach the network/i)).toBeTruthy();
        expect(screen.getByRole('status')).toBeTruthy();
        const buttons = screen.getAllByRole('button', { name: 'Done' });
        expect(buttons.length).toBe(1);
    });

    it('uses distinct copy without automatic retry claims', () => {
        expect(SIGNED_NOT_BROADCAST_UNSAVED_WARNING).not.toMatch(/automatically/i);
        expect(SIGNED_NOT_BROADCAST_UNSAVED_WARNING).not.toMatch(/retry/i);
        expect(SIGNED_NOT_BROADCAST_UNSAVED_WARNING).not.toBe(SIGNED_NOT_BROADCAST_MESSAGE);
    });
});
