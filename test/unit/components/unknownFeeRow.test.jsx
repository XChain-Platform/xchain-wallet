// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A miner fee the wallet could not read leaves the coin post-state
// unprojectable, and both surfaces that render a simulation have to SAY that.
// The failure the marker exists to prevent is a concrete post-balance that
// silently excludes the charge; the failure a careless marker would introduce
// is a bare arrow or a literal "undefined" on a signing screen, so both are
// asserted here against a real render.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BalanceChanges } from '../../../packages/core/src/shared/components/BalanceChanges.jsx';
import { ActionIntentSummary } from '../../../packages/core/src/shared/components/ActionIntentSummary.jsx';

afterEach(() => cleanup());

// What simulateAction emits for a 1 BTC send from 10 BTC whose PSBT omits an
// input value: the coin row keeps `before`, drops `after`, and a fee row says
// the amount is unknown. A note explains the absence.
const UNKNOWN_FEE = {
    deltas: [
        { tick: 'BTC', before: '10', after: '', isCoin: true, isFee: false, afterUnknown: true },
        { tick: 'BTC', before: '', after: '', isCoin: true, isFee: true, feeUnknown: true },
    ],
    sideEffects: [],
    notes: ['The network fee could not be read from this transaction, so the projected BTC balance is not shown.'],
};

const DECODED = { summary: 'Send 1 BTC', details: [], warnings: [] };

describe('unknown network fee rendering', () => {
    it('BalanceChanges names the fee unknown rather than pricing it', () => {
        const { container } = render(<BalanceChanges result={UNKNOWN_FEE} />);
        expect(screen.getByText('Network fee')).toBeTruthy();
        expect(container.querySelector('[data-fee-unknown="true"]')).toBeTruthy();
        // Never "BTC undefined", which is what the priced branch would print.
        expect(container.textContent).not.toMatch(/undefined/);
    });

    it('BalanceChanges shows the balance row as before -> unknown, not a bare arrow', () => {
        const { container } = render(<BalanceChanges result={UNKNOWN_FEE} />);
        const row = container.querySelector('[data-after-unknown="true"]');
        expect(row).toBeTruthy();
        expect(row.textContent).toContain('10');
        expect(row.textContent).toContain('unknown');
        // A projected post-state is exactly what must NOT appear.
        expect(row.textContent).not.toMatch(/→\s*9/);
        // directionOf would read the empty string as zero and colour the row a
        // total debit; unknown is not a direction.
        expect(row.getAttribute('data-direction')).toBe('flat');
    });

    it('ActionIntentSummary prints before -> unknown and keeps the note', () => {
        render(<ActionIntentSummary decoded={DECODED} simulation={UNKNOWN_FEE} />);
        expect(screen.getByText('10 → unknown')).toBeTruthy();
        expect(screen.getByText('Network fee')).toBeTruthy();
        expect(screen.getByText(/network fee could not be read/i)).toBeTruthy();
    });

    it('ActionIntentSummary does not print a post-balance that omits the fee', () => {
        const { container } = render(<ActionIntentSummary decoded={DECODED} simulation={UNKNOWN_FEE} />);
        expect(container.textContent).not.toContain('10 → 9');
        expect(container.textContent).not.toMatch(/undefined/);
    });

    // The standalone shape: no other coin row, so the fee row carries the
    // before/after itself.
    it('renders a standalone unknown fee row without inventing an after', () => {
        const standalone = {
            deltas: [
                { tick: 'BTC', before: '10', after: '', isCoin: true, isFee: true, feeUnknown: true, afterUnknown: true },
            ],
            sideEffects: [],
            notes: [],
        };
        const { container } = render(<BalanceChanges result={standalone} />);
        expect(container.textContent).toContain('unknown');
        expect(container.textContent).not.toMatch(/undefined/);
    });
});
