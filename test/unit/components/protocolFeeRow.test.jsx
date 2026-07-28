// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : the two surfaces that render a simulation must name the protocol
// fee as itself. Labelling it "Network fee" would be a second wrong number on
// the screen whose whole job is telling the user what the action costs, and
// dropping it leaves the fee undisclosed while the miner fee is quoted to
// eight decimals.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BalanceChanges } from '../../../packages/core/src/shared/components/BalanceChanges.jsx';
import { ActionIntentSummary } from '../../../packages/core/src/shared/components/ActionIntentSummary.jsx';

afterEach(() => cleanup());

// What simulateAction emits for an ISSUE paying its protocol fee in BTC:
// the coin row carries both debits, the two label rows price them apart.
const SIMULATION = {
    deltas: [
        {
            tick: 'BTC',
            before: '2.99993667',
            after: '2.99990491',
            isCoin: true,
            isFee: true,
            feeAmount: '0.00001176',
        },
        {
            tick: 'BTC',
            before: '',
            after: '',
            isCoin: true,
            isFee: true,
            isProtocolFee: true,
            feeLabel: 'Protocol fee',
            feeAmount: '0.00002',
        },
    ],
    sideEffects: [],
    notes: [],
};

const DECODED = { summary: 'Issue 1000 S19FEE', details: [], warnings: [] };

describe('protocol-fee row rendering', () => {
    it('BalanceChanges labels the protocol fee as its own line', () => {
        render(<BalanceChanges result={SIMULATION} />);
        expect(screen.getByText('Protocol fee')).toBeTruthy();
        expect(screen.getByText('Network fee')).toBeTruthy();
        // The two amounts stay distinct: the miner fee is not restated as the
        // total, and the protocol fee is not folded into the "Network fee".
        expect(screen.getByText(/BTC 0\.00002$/)).toBeTruthy();
    });

    it('ActionIntentSummary prices the protocol fee instead of printing a bare arrow', () => {
        render(<ActionIntentSummary decoded={DECODED} simulation={SIMULATION} />);
        expect(screen.getByText('Protocol fee')).toBeTruthy();
        expect(screen.getByText('BTC 0.00002')).toBeTruthy();
        // The balance row is the post-state the user checks against the chain.
        expect(screen.getByText('2.99993667 → 2.99990491')).toBeTruthy();
    });

    it('ActionIntentSummary drops label-only rows that carry no protocol fee', () => {
        const paired = {
            deltas: [
                { tick: 'BTC', before: '1', after: '0.9989', isCoin: true, isFee: false },
                { tick: 'BTC', before: '', after: '', isCoin: true, isFee: true, feeAmount: '0.0001' },
            ],
            sideEffects: [],
            notes: [],
        };
        const { container } = render(<ActionIntentSummary decoded={DECODED} simulation={paired} />);
        expect(container.querySelectorAll('[data-testid="action-intent-deltas"] > div')).toHaveLength(1);
    });
});
