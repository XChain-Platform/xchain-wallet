// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// M2.5 balance honesty, as an executable guard rather than a claim.
//
// Showing unconfirmed transactions in History creates an obvious temptation
// and an obvious hazard: a pending INCOMING payment looks like money, and if
// it ever reached the spendable balance the wallet would let the user spend
// coins the network has not accepted, against a transaction the indexer can
// still reject at confirmation. The rule is one-directional. Our own pending
// DEBITS may be netted OUT of what is spendable, because committing them
// twice is the real spend hazard. Nothing pending is ever netted IN.
//
// This is a guard on a property, not on today's implementation: the balance
// path does not read the mempool at all right now, and these tests are what
// notice if that ever changes.

import { describe, it, expect } from 'vitest';
import {
    unconfirmedPendingDeltas,
    UNCONFIRMED_COMMITTED_STATUSES,
} from '../../../packages/core/src/flows/pendingDeltas.js';

const VENUE = { coin: 'LTC', network: 'regtest', source: 'mtkx2FQours' };
const THEIRS = 'moV6MFmTheirs';

function pendingTx(over = {}) {
    return {
        id: 'ptx-1',
        chain: 'LTC',
        network: 'regtest',
        fromAddress: VENUE.source,
        toAddress: THEIRS,
        action: 'SEND',
        txid: 'aabbcc',
        status: 'broadcast',
        tick: 'XCHAIN',
        amount: '100',
        ...over,
    };
}

describe('pending amounts never become spendable balance', () => {
    it('nets out a pending debit we sent ourselves', () => {
        expect(unconfirmedPendingDeltas([pendingTx()], VENUE))
            .toEqual([{ tick: 'XCHAIN', amount: '100' }]);
    });

    it('ignores a pending transaction that is paying US, not from us', () => {
        // The whole hazard in one case: an incoming pending payment must
        // contribute nothing at all, in either direction.
        const incoming = pendingTx({ fromAddress: THEIRS, toAddress: VENUE.source });
        expect(unconfirmedPendingDeltas([incoming], VENUE)).toEqual([]);
    });

    it('refuses a negative amount, which would net as a CREDIT', () => {
        // The schema checks only that `amount` is a string, so nothing
        // upstream rules this out. Subtracting a negative number adds it, and
        // the sum is what the user is allowed to spend.
        expect(unconfirmedPendingDeltas([pendingTx({ amount: '-100' })], VENUE)).toEqual([]);
    });

    it('refuses a zero or unparseable amount rather than netting nonsense', () => {
        for (const amount of ['0', '0.000', 'NaN', 'Infinity', '1e5', ' ', 'abc']) {
            expect(unconfirmedPendingDeltas([pendingTx({ amount })], VENUE), amount).toEqual([]);
        }
    });

    it('still nets a large amount no float could hold exactly', () => {
        // The guard tests the string's shape, not `Number(amount) > 0`, so a
        // precise decimal string survives it intact.
        const big = '92233720368547758.07';
        expect(unconfirmedPendingDeltas([pendingTx({ amount: big })], VENUE))
            .toEqual([{ tick: 'XCHAIN', amount: big }]);
    });

    it('stops netting a transaction once it is indexed, which would double-count', () => {
        expect(unconfirmedPendingDeltas([pendingTx({ status: 'indexed' })], VENUE)).toEqual([]);
    });

    it('stops netting a transaction that is no longer live', () => {
        for (const status of ['failed', 'rbf-replaced']) {
            expect(unconfirmedPendingDeltas([pendingTx({ status })], VENUE), status).toEqual([]);
        }
    });

    it('does not net across coins or networks', () => {
        expect(unconfirmedPendingDeltas([pendingTx({ chain: 'DOGE' })], VENUE)).toEqual([]);
        expect(unconfirmedPendingDeltas([pendingTx({ network: 'mainnet' })], VENUE)).toEqual([]);
    });

    it('leaves the committed-status set as the only thing that can net', () => {
        // If a status is ever added here, it has to be a spend we have
        // committed to, or the wallet starts under-reporting what is
        // spendable for transactions that were never sent.
        expect([...UNCONFIRMED_COMMITTED_STATUSES])
            .toEqual(['signed', 'queued', 'broadcasting', 'broadcast']);
    });
});
