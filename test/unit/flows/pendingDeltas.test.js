// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  / §4.7: the concurrent-window pending-delta netting that covers the
// broadcast -> confirmation gap the in-memory reservation no longer holds.

import { describe, it, expect } from 'vitest';
import { unconfirmedPendingDeltas } from '../../../packages/core/src/flows/pendingDeltas.js';
import { sendDeltaFromAction } from '../../../packages/core/src/flows/submitAction.js';

const VENUE = { coin: 'bitcoin', network: 'regtest', source: 'bcrt1qsrc' };

function tx(over = {}) {
    return {
        chain: 'bitcoin', network: 'regtest', fromAddress: 'bcrt1qsrc',
        status: 'broadcast', tick: 'XCHAIN', amount: '600', ...over,
    };
}

describe('unconfirmedPendingDeltas ', () => {
    it('nets a broadcast-but-unconfirmed SEND debit for the matching venue+source', () => {
        expect(unconfirmedPendingDeltas([tx()], VENUE)).toEqual([{ tick: 'XCHAIN', amount: '600' }]);
    });

    it('nets every committed-unconfirmed status', () => {
        for (const status of ['signed', 'queued', 'broadcasting', 'broadcast']) {
            expect(unconfirmedPendingDeltas([tx({ status })], VENUE)).toHaveLength(1);
        }
    });

    it('does NOT net a confirmed (indexed) tx - the balance already reflects it', () => {
        expect(unconfirmedPendingDeltas([tx({ status: 'indexed' })], VENUE)).toEqual([]);
    });

    it('does NOT net pre-commit or dead statuses', () => {
        for (const status of ['composing', 'awaiting-signature', 'failed', 'rbf-replaced']) {
            expect(unconfirmedPendingDeltas([tx({ status })], VENUE)).toEqual([]);
        }
    });

    it('filters by source address and by chain/network', () => {
        expect(unconfirmedPendingDeltas([tx({ fromAddress: 'bcrt1qother' })], VENUE)).toEqual([]);
        expect(unconfirmedPendingDeltas([tx({ chain: 'litecoin' })], VENUE)).toEqual([]);
        expect(unconfirmedPendingDeltas([tx({ network: 'mainnet' })], VENUE)).toEqual([]);
    });

    it('skips records with no v2 tick/amount (native / multi-tick)', () => {
        expect(unconfirmedPendingDeltas([tx({ tick: null })], VENUE)).toEqual([]);
        expect(unconfirmedPendingDeltas([tx({ amount: null })], VENUE)).toEqual([]);
    });

    it('returns [] for an empty list or missing source', () => {
        expect(unconfirmedPendingDeltas([], VENUE)).toEqual([]);
        expect(unconfirmedPendingDeltas([tx()], { coin: 'bitcoin', network: 'regtest' })).toEqual([]);
    });
});

describe('sendDeltaFromAction ', () => {
    it('returns the tick+amount of a single-leg SEND', () => {
        expect(sendDeltaFromAction({ action: 'SEND', params: { TICK: 'XCHAIN', AMOUNT: '600' } }))
            .toEqual({ tick: 'XCHAIN', amount: '600' });
    });

    it('returns null for a multi-leg SEND (ambiguous single debit)', () => {
        expect(sendDeltaFromAction({ action: 'SEND', params: { TICK: ['A', 'B'], AMOUNT: ['1', '2'] } }))
            .toBeNull();
    });

    it('returns null for a non-SEND action', () => {
        expect(sendDeltaFromAction({ action: 'MINT', params: { TICK: 'XCHAIN', AMOUNT: '1000' } })).toBeNull();
        expect(sendDeltaFromAction(null)).toBeNull();
    });

    it('returns null when tick or amount is missing', () => {
        expect(sendDeltaFromAction({ action: 'SEND', params: { AMOUNT: '600' } })).toBeNull();
        expect(sendDeltaFromAction({ action: 'SEND', params: { TICK: 'XCHAIN' } })).toBeNull();
    });
});
