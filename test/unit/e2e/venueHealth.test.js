// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { venueStartDecision } from '../../e2e/fixtures/venueHealth.js';

const status = ({
    decoderHealth = 'healthy',
    indexerState = 'ready',
    lastBlock = 97,
    tip = 100,
} = {}) => ({
    chain_lag_blocks: { RBTC: 0 },
    chain_tip: { RBTC: tip },
    decoder_health: { RBTC: decoderHealth },
    indexer_state: { RBTC: indexerState },
    last_block: { RBTC: lastBlock },
});

describe('venueStartDecision', () => {
    it('waits for a gap when the indexer reports that it is behind', () => {
        const decision = venueStartDecision(status({ indexerState: 'behind' }), 'RBTC');
        expect(decision).toMatchObject({ action: 'wait', catchingUp: true });
        expect(decision.verdict).not.toMatch(/WEDGED/);
    });

    it('waits for a gap when the indexed height rose since the previous read', () => {
        const decision = venueStartDecision(status(), 'RBTC', {
            lastAdvanceAtMs: 0,
            observedAtMs: 30_000,
            previousLastBlock: 96,
        });
        expect(decision).toMatchObject({
            action: 'wait', catchingUp: true, lastAdvanceAtMs: 30_000,
        });
        expect(decision.verdict).not.toMatch(/WEDGED/);
    });

    it('calls a gap of three or more WEDGED after 30 seconds without progress', () => {
        expect(venueStartDecision(status(), 'RBTC', {
            lastAdvanceAtMs: 0,
            observedAtMs: 29_999,
            previousLastBlock: 97,
        })).toMatchObject({ action: 'wait', catchingUp: false });
        expect(venueStartDecision(status({ indexerState: 'behind' }), 'RBTC', {
            lastAdvanceAtMs: 0,
            observedAtMs: 30_000,
            previousLastBlock: 97,
        })).toMatchObject({ action: 'fail', verdict: expect.stringMatching(/WEDGED/) });
    });

    it('fails an unhealthy decoder immediately', () => {
        expect(venueStartDecision(status({ decoderHealth: 'unreachable' }), 'RBTC'))
            .toMatchObject({ action: 'fail', verdict: expect.stringMatching(/unreachable/) });
    });

    it('fails a missing chain immediately', () => {
        expect(venueStartDecision({}, 'RBTC'))
            .toMatchObject({ action: 'fail', verdict: expect.stringMatching(/reports no RBTC chain/) });
    });
});
