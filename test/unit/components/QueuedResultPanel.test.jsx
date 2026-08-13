// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueuedResultPanel } from '../../../packages/core/src/shared/components/QueuedResultPanel.jsx';

afterEach(() => cleanup());

describe('QueuedResultPanel', () => {
    it('says the transaction is signed and not yet broadcast', () => {
        render(<QueuedResultPanel onDone={() => {}} />);
        expect(screen.getByText('Signed. Not broadcast yet.')).toBeTruthy();
        expect(screen.getByText(/signed but couldn't reach the network/i)).toBeTruthy();
        // It must not claim the action happened.
        expect(screen.queryByText(/broadcast complete/i)).toBeNull();
    });

    // : nothing in the wallet re-broadcasts a queued transaction, so the
    // panel may promise a reminder and never an automatic retry.
    it('promises a reminder, not an automatic re-broadcast', () => {
        render(<QueuedResultPanel onDone={() => {}} />);
        expect(screen.getByText(/reminds you when the network is back/i)).toBeTruthy();
        expect(screen.getByText(/only goes out when you broadcast it/i)).toBeTruthy();
        expect(screen.queryByText(/automatically/i)).toBeNull();
        expect(screen.queryByText(/broadcast will retry/i)).toBeNull();
    });

    // The whole point of the panel: the user has to know a signed copy exists,
    // or they submit a second one (the §5.3.4 double-broadcast trap).
    it('points at the queue and warns against submitting again', () => {
        render(<QueuedResultPanel onDone={() => {}} />);
        expect(screen.getByText(/queued-transactions banner/i)).toBeTruthy();
        expect(screen.getByText(/don't submit this again/i)).toBeTruthy();
    });

    it('names the action when the form supplies one', () => {
        render(<QueuedResultPanel onDone={() => {}} what="dividend" />);
        expect(screen.getByText(/Your dividend is signed/i)).toBeTruthy();
    });

    it('announces itself politely and offers only Done', () => {
        const onDone = vi.fn();
        render(<QueuedResultPanel onDone={onDone} what="mint" />);
        expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBe(1);
        fireEvent.click(buttons[0]);
        expect(onDone).toHaveBeenCalledTimes(1);
    });
});
