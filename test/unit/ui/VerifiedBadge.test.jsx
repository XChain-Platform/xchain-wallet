// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { VerifiedBadge } from '../../../packages/core/src/ui/VerifiedBadge.jsx';

describe('<VerifiedBadge>', () => {
    it('renders a green "Verified" badge for status=verified', () => {
        render(<VerifiedBadge status="verified" />);
        const el = screen.getByTestId('verified-badge');
        expect(el.getAttribute('data-status')).toBe('verified');
        expect(el.textContent).toContain('Verified');
    });

    it('renders a "Proof failed" badge for status=failed', () => {
        render(<VerifiedBadge status="failed" />);
        const el = screen.getByTestId('verified-badge');
        expect(el.getAttribute('data-status')).toBe('failed');
        expect(el.textContent).toContain('Proof failed');
    });

    it('renders an "Unverified" badge for status=unavailable', () => {
        render(<VerifiedBadge status="unavailable" />);
        expect(screen.getByTestId('verified-badge').textContent).toContain('Unverified');
    });

    it('renders a "Verifying" badge for status=pending', () => {
        render(<VerifiedBadge status="pending" />);
        expect(screen.getByTestId('verified-badge').textContent).toContain('Verifying');
    });

    it('renders nothing for an unknown / not-applicable status (e.g. the native coin)', () => {
        const { container } = render(<VerifiedBadge status="n/a" />);
        expect(container.firstChild).toBeNull();
        expect(screen.queryByTestId('verified-badge')).toBeNull();
    });

    it('opens the plain-language reason from a touch-accessible info tip', () => {
        render(<VerifiedBadge status="unavailable" reason="NOT_YET_CHECKPOINTED" />);
        const trigger = screen.getByRole('button', { name: 'Unverified details' });

        expect(screen.getByTestId('verified-badge').hasAttribute('title')).toBe(false);
        fireEvent.pointerDown(trigger, { pointerType: 'touch' });
        fireEvent.click(trigger);
        expect(screen.getByRole('tooltip').textContent).toContain('too new to verify');
        expect(screen.getByRole('tooltip').textContent).not.toMatch(/checkpoint|quorum/i);
    });

    it('keeps consensus jargon out of every badge info tip', () => {
        for (const status of ['verified', 'pending', 'failed', 'unavailable']) {
            const { unmount } = render(<VerifiedBadge status={status} />);
            const tip = screen.getByRole('tooltip', { hidden: true });
            expect(tip.textContent).not.toMatch(/quorum|checkpoint|state commitment/i);
            unmount();
        }
    });

    it('shows NO parenthetical for an unmapped reason (raw code stays out of the info tip)', () => {
        render(<VerifiedBadge status="failed" reason="LEAF_AMOUNT_MISMATCH" />);
        const tip = screen.getByRole('tooltip', { hidden: true }).textContent;
        // The badge label carries the verdict; an unrecognized SCREAMING_SNAKE
        // code (or a raw transport message) must not leak into the info tip.
        expect(tip).not.toContain('LEAF_AMOUNT_MISMATCH');
        expect(tip).not.toContain('(');
    });
});
